import type { PeerVisibility, Role } from '@hm/shared';
import { type SQL, and, desc, eq, lt, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { contacts, conversations, inboxVisibilitySettings, messages, teams } from '../schema';

export const contactsRepo = {
  async findById(id: string) {
    const [row] = await getDb().select().from(contacts).where(eq(contacts.id, id));
    return row ?? null;
  },
};

export const conversationsRepo = {
  async findById(id: string) {
    const [row] = await getDb().select().from(conversations).where(eq(conversations.id, id));
    return row ?? null;
  },
  async findByChannelRemote(channelId: string, remoteId: string) {
    const [row] = await getDb()
      .select()
      .from(conversations)
      .where(and(eq(conversations.channelId, channelId), eq(conversations.remoteId, remoteId)));
    return row ?? null;
  },
};

// ─── Inbox visibility & auto-assign (F30 / LIVECHAT_OPS §1/§4) ─────────────────

/** Contexto do membro autenticado para escopar a list query de conversas. */
export interface VisibilityContext {
  memberId: string;
  role: Role;
  workspaceId: string;
}

/**
 * Predicado SQL de visibilidade da inbox para a list query (S07). Combina os dois
 * eixos de `LIVECHAT_OPS §1`:
 *   - Eixo 1 (escopo): OWNER/ADMIN/READONLY veem tudo; SUPERVISOR vê os depts que
 *     lidera (`team_members.role='lead'`); AGENT vê os depts a que pertence +
 *     overrides explícitos.
 *   - Eixo 2 (peer): só restringe AGENT — em `private`, vê apenas as suas atribuídas
 *     ou as dos times em que é lead. `private` é resolvido por conversa
 *     (`team.peer_visibility` ?? `workspace.default`), tratando `inherit`.
 *
 * Aplicado sobre a tabela `conversations` (deve estar no FROM da query).
 */
export function buildVisibilityPredicate(ctx: VisibilityContext): SQL {
  const { memberId, role } = ctx;

  // OWNER/ADMIN não filtram; READONLY enxerga toda a inbox em leitura (default).
  if (role === 'OWNER' || role === 'ADMIN' || role === 'READONLY') return sql`true`;

  const leadOnly = role === 'SUPERVISOR';
  const leadFilter = leadOnly ? sql`and tm.role = 'lead'` : sql``;

  // Departamentos visíveis ao membro (eixo 1).
  const visibleDepts = sql`(
    select t.department_id from team_members tm
      join teams t on t.id = tm.team_id
      where tm.member_id = ${memberId} and t.department_id is not null ${leadFilter}
    union
    select mvo.department_id from member_visibility_overrides mvo
      where mvo.member_id = ${memberId}
  )`;

  const deptVisible = sql`(${conversations.departmentId} in ${visibleDepts} or ${conversations.assignedTo} = ${memberId})`;

  // SUPERVISOR vê tudo dentro dos depts que lidera (sem filtro peer).
  if (role !== 'AGENT') return deptVisible;

  // Eixo 2: privacidade entre colegas, resolvida por conversa (trata `inherit`).
  const peerResolved = sql`(
    case when ${conversations.teamId} is not null then
      coalesce(
        nullif((select t.peer_visibility from teams t where t.id = ${conversations.teamId}), 'inherit'),
        (select s.default_peer_visibility from inbox_visibility_settings s where s.workspace_id = ${conversations.workspaceId}),
        'shared')
    else
      coalesce(
        (select s.default_peer_visibility from inbox_visibility_settings s where s.workspace_id = ${conversations.workspaceId}),
        'shared')
    end)`;

  const peerOk = sql`(
    ${peerResolved} = 'shared'
    or ${conversations.assignedTo} = ${memberId}
    or exists (
      select 1 from team_members tm
        where tm.team_id = ${conversations.teamId} and tm.member_id = ${memberId} and tm.role = 'lead'
    )
  )`;

  return sql`(${deptVisible} and ${peerOk})`;
}

/** Identifica uma conversa para resolver a privacidade entre colegas (eixo 2). */
export interface PeerVisibilityInput {
  workspaceId: string;
  teamId: string | null;
}

/**
 * Resolve `shared|private` para uma conversa: `team.peer_visibility` (se ≠ `inherit`)
 * senão `inbox_visibility_settings.default_peer_visibility` (default `shared`).
 */
export async function resolvePeerVisibility(input: PeerVisibilityInput): Promise<PeerVisibility> {
  const db = getDb();
  if (input.teamId) {
    const [team] = await db
      .select({ pv: teams.peerVisibility })
      .from(teams)
      .where(eq(teams.id, input.teamId));
    if (team && team.pv !== 'inherit') return team.pv === 'private' ? 'private' : 'shared';
  }
  const [settings] = await db
    .select({ dpv: inboxVisibilitySettings.defaultPeerVisibility })
    .from(inboxVisibilitySettings)
    .where(eq(inboxVisibilitySettings.workspaceId, input.workspaceId));
  return settings?.dpv === 'private' ? 'private' : 'shared';
}

/** Estratégia de auto-assign do time (`teams.auto_assign_strategy`). */
export type AutoAssignStrategy = 'round_robin' | 'least_busy' | 'manual';

export interface AutoAssignInput {
  teamId: string;
  strategy: AutoAssignStrategy;
}

/**
 * Candidato a receber a conversa no inbound (S09). `manual` → null (entra na fila).
 *   - `least_busy`: membro ativo com menos conversas abertas atribuídas.
 *   - `round_robin`: membro ativo "menos recentemente" ocupado (rodízio aproximado).
 */
export async function pickAutoAssignee(input: AutoAssignInput): Promise<string | null> {
  if (input.strategy === 'manual') return null;
  const db = getDb();

  const order =
    input.strategy === 'least_busy'
      ? sql`count(c.id) asc, tm.member_id asc`
      : sql`max(c.last_message_at) asc nulls first, tm.member_id asc`;

  const busyJoin =
    input.strategy === 'least_busy'
      ? sql`left join conversations c on c.assigned_to = tm.member_id and c.status in ('open','pending')`
      : sql`left join conversations c on c.assigned_to = tm.member_id`;

  const rows = await db.execute<{ member_id: string }>(sql`
    select tm.member_id
    from team_members tm
    join members m on m.id = tm.member_id and m.status = 'active'
    ${busyJoin}
    where tm.team_id = ${input.teamId}
    group by tm.member_id
    order by ${order}
    limit 1
  `);
  const first = Array.from(rows)[0];
  return first?.member_id ?? null;
}

export const messagesRepo = {
  /** Página de mensagens por conversa, ordenada por created_at desc, com cursor. */
  async listByConversation(conversationId: string, opts: { before?: Date; limit?: number } = {}) {
    const limit = Math.min(opts.limit ?? 50, 100);
    const where = opts.before
      ? and(eq(messages.conversationId, conversationId), lt(messages.createdAt, opts.before))
      : eq(messages.conversationId, conversationId);
    return getDb()
      .select()
      .from(messages)
      .where(where)
      .orderBy(desc(messages.createdAt))
      .limit(limit);
  },
};
