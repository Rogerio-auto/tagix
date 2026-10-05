/**
 * Membership por pessoa (F71-S01 — CONTAS_E_CONVITES §3.2 e §6/T5).
 *
 * A sessão resolve o membro pela PESSOA (`auth_user_id`), nunca pelo email: quem está em
 * várias empresas tem uma linha de `members` por empresa, e só linhas `active` dão acesso.
 * `invited` (dono pré-verify), `inactive` (removido) e `blocked` ficam de fora.
 *
 * PRIVILEGIADO (`getDb()`, fora da RLS), como o resto da resolução de sessão: a sessão é
 * resolvida antes de existir empresa no escopo. Cada consulta filtra explicitamente por
 * `auth_user_id` (e por empresa, quando há uma); o `hm_workspace` vindo do cookie só vale se
 * `findActive` devolver a linha (T5).
 */
import { ROLES, type Role } from '@hm/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { members, workspaces } from '../schema';

type MemberRow = typeof members.$inferSelect;

/** Empresa em que a pessoa é membro ativo — seletor de empresa e `GET /api/me`. */
export interface ActiveMembership {
  memberId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: Role;
  /** Status da assinatura da empresa (`trial`, `active`, `past_due`, `canceled`, `expired`). */
  subscriptionStatus: string;
  /** Última entrada/troca para a empresa; null = nunca registrada. */
  lastActiveAt: Date | null;
}

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export const membershipsRepo = {
  /**
   * Empresas em que a pessoa é membro `active`, da mais recentemente usada para a menos (a
   * primeira é a empresa padrão no login); sem `last_active_at`, a mais antiga primeiro.
   * Usa `idx_members_auth_user`.
   */
  async listActiveByAuthUser(authUserId: string): Promise<ActiveMembership[]> {
    const rows = await getDb()
      .select({
        memberId: members.id,
        workspaceId: members.workspaceId,
        workspaceName: workspaces.name,
        workspaceSlug: workspaces.slug,
        role: members.role,
        subscriptionStatus: workspaces.subscriptionStatus,
        lastActiveAt: members.lastActiveAt,
      })
      .from(members)
      .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
      .where(and(eq(members.authUserId, authUserId), eq(members.status, 'active')))
      .orderBy(sql`${members.lastActiveAt} desc nulls last`, asc(members.createdAt));
    const out: ActiveMembership[] = [];
    for (const row of rows) {
      // members_role_chk garante o domínio; o filtro só estreita o tipo sem cast.
      if (isRole(row.role)) out.push({ ...row, role: row.role });
    }
    return out;
  },

  /**
   * O membro `active` desta pessoa NESTA empresa, ou null. É a validação do `hm_workspace`
   * a cada request (T5).
   */
  async findActive(authUserId: string, workspaceId: string): Promise<MemberRow | null> {
    const [row] = await getDb()
      .select()
      .from(members)
      .where(
        and(
          eq(members.workspaceId, workspaceId),
          eq(members.authUserId, authUserId),
          eq(members.status, 'active'),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  /**
   * Marca a empresa como a última usada pela pessoa (login, troca de empresa). Só para
   * membro `active`. Não é presença (`is_online`/`last_seen_at`): chamar na entrada, não a
   * cada request.
   */
  async touchLastActive(memberId: string): Promise<void> {
    await getDb()
      .update(members)
      .set({ lastActiveAt: sql`now()` })
      .where(and(eq(members.id, memberId), eq(members.status, 'active')));
  },
};
