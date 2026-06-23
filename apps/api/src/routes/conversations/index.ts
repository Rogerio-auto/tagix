import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, desc, eq, ilike, lt, sql, type SQL } from 'drizzle-orm';
import { assertConversationVisible, buildVisibilityPredicate, schema } from '@hm/db';
import type { Role } from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { bumpVersion, cached, getVersion } from '../../cache';

const PROVIDERS = ['meta_whatsapp', 'meta_instagram', 'waha'] as const;
const STATUSES = ['open', 'pending', 'closed', 'resolved', 'snoozed'] as const;

/**
 * `assigned` aceita três formas:
 *  - `"me"` → conversas atribuídas ao membro autenticado
 *  - `"others"` → conversas atribuídas a outros (não ao membro autenticado, não nulas)
 *  - UUID → conversa atribuída a um membro específico (por id)
 */
const UUID_RE = /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i;

const listQuery = z.object({
  status: z.enum(STATUSES).optional(),
  assigned: z
    .string()
    .refine(
      (v) => v === 'me' || v === 'others' || UUID_RE.test(v),
      { message: '"assigned" deve ser "me", "others" ou um UUID válido.' },
    )
    .optional(),
  department: z.string().uuid('department deve ser um UUID.').optional(),
  team: z.string().uuid('team deve ser um UUID.').optional(),
  provider: z.enum(PROVIDERS).optional(),
  search: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const messagesQuery = z.object({
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export function createConversationsRouter(): Router {
  const router = Router();
  const guard = [requireAuth, withRLS, requireRole('conversation.view')] as const;

  /**
   * GET /api/conversations
   * Lista filtrada do workspace (RLS-escopada), com cache versionado.
   *
   * Aplica os dois eixos de visibilidade (F30-S07 / LIVECHAT_OPS §1):
   *   - Eixo 1: escopo por role + override (OWNER/ADMIN = tudo; SUPERVISOR = depts liderados;
   *             AGENT = depts em team_members + member_visibility_overrides).
   *   - Eixo 2: peer-privacy (AGENT em time `private` só vê as suas ou as do time que lidera).
   *
   * Filtros de distribuição novos: department / team / assigned (me | others | <uuid>).
   *
   * Cache key inclui memberId + role para isolar escopos entre membros distintos.
   */
  router.get('/api/conversations', ...guard, async (req: Request, res: Response) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: 'Filtros inválidos.', errors: parsed.error.flatten() });
      return;
    }

    const { status, assigned, department, team, provider, search, limit = 50 } = parsed.data;
    const workspaceId = req.auth!.workspace.id;
    const memberId = req.auth!.member.id;
    const role = req.auth!.member.role as Role;

    const version = await getVersion(`hm:ws:v:${workspaceId}`);

    // Cache key por membro + role: evita que um AGENT envenene a lista de outro
    // com escopo diferente (gotcha crítico de privacidade).
    const scopeKey = `${memberId}:${role}`;
    const filterHash = JSON.stringify({ status, assigned, department, team, provider, search, limit });
    const key = `hm:conv:list:${workspaceId}:v${version}:${scopeKey}:${filterHash}`;

    const rows = await cached(key, 120, () =>
      req.scoped!(async (tx) => {
        const conds: SQL[] = [];

        // ── Eixo de visibilidade (dois eixos, F30-S07) ───────────────────────────
        conds.push(buildVisibilityPredicate({ memberId, role, workspaceId }));

        // ── Filtros existentes ────────────────────────────────────────────────────
        if (status) conds.push(eq(schema.conversations.status, status));
        if (provider) conds.push(eq(schema.channels.provider, provider));
        if (search) conds.push(ilike(schema.conversations.lastMessagePreview, `%${search}%`));

        // ── Filtros de distribuição (F30-S07) ─────────────────────────────────────
        if (department) conds.push(eq(schema.conversations.departmentId, department));
        if (team) conds.push(eq(schema.conversations.teamId, team));

        if (assigned === 'me') {
          conds.push(eq(schema.conversations.assignedTo, memberId));
        } else if (assigned === 'others') {
          // Atribuídas a algum membro que não seja o autenticado
          conds.push(
            sql`(${schema.conversations.assignedTo} is not null and ${schema.conversations.assignedTo} != ${memberId}::uuid)`,
          );
        } else if (assigned !== undefined) {
          // UUID específico
          conds.push(eq(schema.conversations.assignedTo, assigned));
        }

        const where = and(...conds);

        return tx
          .select({ conversation: schema.conversations })
          .from(schema.conversations)
          .innerJoin(schema.channels, eq(schema.conversations.channelId, schema.channels.id))
          .where(where)
          .orderBy(desc(schema.conversations.lastMessageAt))
          .limit(limit)
          .then((r) => r.map((x) => x.conversation));
      }),
    );

    res.json({ conversations: rows });
  });

  /**
   * GET /api/conversations/routing-targets — membros + departamentos elegíveis
   * como alvo de atribuição/transferência (cockpit RoutingMenu, F1-S23).
   *
   * Gated por `conversation.assign` (STAFF — mesmo tier de `conversation.transfer`):
   * quem pode rotear vê a lista de colegas + departamentos. Sem este endpoint o
   * RoutingMenu não tinha de onde popular os alvos de transferência — só existiam
   * `/api/members` e `/api/departments`, gated por permissão de EDIÇÃO (OWNER/ADMIN),
   * inacessíveis ao SUPERVISOR/AGENT que rota. Precede a rota `/:id` (senão o
   * detalhe captura `routing-targets` como id).
   */
  router.get(
    '/api/conversations/routing-targets',
    requireAuth,
    withRLS,
    requireRole('conversation.assign'),
    async (req: Request, res: Response) => {
      const data = await req.scoped!(async (tx) => {
        const memberRows = await tx
          .select({
            id: schema.members.id,
            name: schema.members.name,
            email: schema.members.email,
            avatarUrl: schema.members.avatarUrl,
          })
          .from(schema.members)
          .where(eq(schema.members.status, 'active'))
          .orderBy(schema.members.name);
        const deptRows = await tx
          .select({ id: schema.departments.id, name: schema.departments.name })
          .from(schema.departments)
          .where(eq(schema.departments.isActive, 'active'))
          .orderBy(schema.departments.name);
        return { members: memberRows, departments: deptRows };
      });
      res.json(data);
    },
  );

  /**
   * GET /api/conversations/:id — detalhe completo da conversa (cockpit F30-S03).
   *
   * Enriquece a linha de `conversations` com o provider do canal + os nomes de
   * responsável (member) e departamento — os campos que o `ContactInfoPanel` e o
   * `ConversationHeader` consomem via `useConversationDetail`. Guard de
   * visibilidade por-conversa (S07.1): 404 = não confirma existência a quem não
   * enxerga a conversa, precedendo qualquer vazamento de estado.
   */
  router.get('/api/conversations/:id', ...guard, async (req: Request, res: Response) => {
    const rawId = req.params['id'];
    const conversationId = typeof rawId === 'string' ? rawId : '';
    if (!conversationId) {
      res.status(400).json({ message: 'id ausente.' });
      return;
    }
    const memberId = req.auth!.member.id;
    const role = req.auth!.member.role as Role;
    const workspaceId = req.auth!.workspace.id;

    const detail = await req.scoped!(async (tx) => {
      if (!(await assertConversationVisible(tx, { memberId, role, workspaceId }, conversationId))) {
        return null;
      }
      const [row] = await tx
        .select({
          conversation: schema.conversations,
          channelProvider: schema.channels.provider,
          assignedToName: schema.members.name,
          departmentName: schema.departments.name,
          agentName: schema.agents.name,
        })
        .from(schema.conversations)
        .innerJoin(schema.channels, eq(schema.conversations.channelId, schema.channels.id))
        .leftJoin(schema.members, eq(schema.conversations.assignedTo, schema.members.id))
        .leftJoin(schema.departments, eq(schema.conversations.departmentId, schema.departments.id))
        .leftJoin(schema.agents, eq(schema.conversations.agentId, schema.agents.id))
        .where(eq(schema.conversations.id, conversationId))
        .limit(1);
      if (!row) return null;

      // Estágio: a conversa não referencia stage; vem do deal vinculado a ela
      // (deals.conversation_id). Pega o mais recente + o nome do stage.
      const [deal] = await tx
        .select({ stageName: schema.stages.name })
        .from(schema.deals)
        .innerJoin(schema.stages, eq(schema.deals.stageId, schema.stages.id))
        .where(eq(schema.deals.conversationId, conversationId))
        .orderBy(desc(schema.deals.createdAt))
        .limit(1);

      return { ...row, stageName: deal?.stageName ?? null };
    });

    if (detail === null) {
      res.status(404).json({ message: 'Conversa não encontrada.' });
      return;
    }

    const c = detail.conversation;
    res.json({
      conversation: {
        id: c.id,
        contactId: c.contactId,
        channelId: c.channelId,
        channelProvider: detail.channelProvider,
        remoteId: c.remoteId,
        kind: c.kind,
        status: c.status,
        aiMode: c.aiMode,
        aiPausedReason: c.aiPausedReason,
        aiPausedAt: c.aiPausedAt,
        assignedTo: c.assignedTo,
        assignedToName: detail.assignedToName,
        departmentId: c.departmentId,
        departmentName: detail.departmentName,
        // Agente de IA atual + nome (read-only no cockpit p/ quem não pode trocar).
        agentId: c.agentId,
        agentName: detail.agentName,
        // Estágio do deal vinculado à conversa (null se não houver deal).
        stageName: detail.stageName,
        unreadCount: c.unreadCount,
        lastMessageAt: c.lastMessageAt,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      },
    });
  });

  // GET /api/conversations/:id/messages — página por cursor (created_at desc).
  router.get('/api/conversations/:id/messages', ...guard, async (req: Request, res: Response) => {
    const parsed = messagesQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: 'Parâmetros inválidos.' });
      return;
    }
    const rawId = req.params['id'];
    const conversationId = typeof rawId === 'string' ? rawId : '';
    if (!conversationId) {
      res.status(400).json({ message: 'id ausente.' });
      return;
    }
    const { before, limit = 50 } = parsed.data;
    const memberId = req.auth!.member.id;
    const role = req.auth!.member.role as Role;
    const workspaceId = req.auth!.workspace.id;
    const base = eq(schema.messages.conversationId, conversationId);
    const where = before ? and(base, lt(schema.messages.createdAt, before)) : base;
    // Guard de visibilidade por-conversa (S07.1): a lista esconde, o acesso por id
    // também precisa negar quem não enxerga a conversa. 404 = não confirma existência.
    const messages = await req.scoped!(async (tx) => {
      if (!(await assertConversationVisible(tx, { memberId, role, workspaceId }, conversationId))) {
        return null;
      }
      return tx
        .select()
        .from(schema.messages)
        .where(where)
        .orderBy(desc(schema.messages.createdAt))
        .limit(limit);
    });
    if (messages === null) {
      res.status(404).json({ message: 'Conversa não encontrada.' });
      return;
    }
    res.json({ messages });
  });

  /**
   * POST /api/conversations/:id/read — zera `unread_count` ao abrir/ler a conversa.
   * O worker de inbound só INCREMENTA o contador; sem este endpoint nada o baixava
   * (o contador nunca limpava ao abrir a conversa). Guard de visibilidade (404 fora
   * de escopo, igual aos demais /:id). Bumpa a versão do cache da lista p/ o próximo
   * GET /api/conversations refletir o zero (senão o cache de 120s mascarava).
   */
  router.post('/api/conversations/:id/read', ...guard, async (req: Request, res: Response) => {
    const rawId = req.params['id'];
    const conversationId = typeof rawId === 'string' ? rawId : '';
    if (!conversationId) {
      res.status(400).json({ message: 'id ausente.' });
      return;
    }
    const memberId = req.auth!.member.id;
    const role = req.auth!.member.role as Role;
    const workspaceId = req.auth!.workspace.id;

    const ok = await req.scoped!(async (tx) => {
      if (!(await assertConversationVisible(tx, { memberId, role, workspaceId }, conversationId))) {
        return false;
      }
      await tx
        .update(schema.conversations)
        .set({ unreadCount: 0 })
        .where(eq(schema.conversations.id, conversationId));
      return true;
    });

    if (!ok) {
      res.status(404).json({ message: 'Conversa não encontrada.' });
      return;
    }
    await bumpVersion(`hm:ws:v:${workspaceId}`);
    res.json({ ok: true });
  });

  return router;
}
