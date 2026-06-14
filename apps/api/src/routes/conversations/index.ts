import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, desc, eq, ilike, lt, sql, type SQL } from 'drizzle-orm';
import { buildVisibilityPredicate, schema } from '@hm/db';
import type { Role } from '@hm/shared';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { cached, getVersion } from '../../cache';

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
    const base = eq(schema.messages.conversationId, conversationId);
    const where = before ? and(base, lt(schema.messages.createdAt, before)) : base;
    const messages = await req.scoped!((tx) =>
      tx
        .select()
        .from(schema.messages)
        .where(where)
        .orderBy(desc(schema.messages.createdAt))
        .limit(limit),
    );
    res.json({ messages });
  });

  return router;
}
