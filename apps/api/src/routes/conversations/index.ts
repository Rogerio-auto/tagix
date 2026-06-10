import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, desc, eq, ilike, lt, type SQL } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { cached, getVersion } from '../../cache';

const PROVIDERS = ['meta_whatsapp', 'meta_instagram', 'waha'] as const;
const STATUSES = ['open', 'pending', 'closed', 'resolved', 'snoozed'] as const;

const listQuery = z.object({
  status: z.enum(STATUSES).optional(),
  assigned: z.string().uuid().optional(),
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

  // GET /api/conversations — lista filtrada do workspace (RLS-escopada), com cache versionado.
  router.get('/api/conversations', ...guard, async (req: Request, res: Response) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: 'Filtros inválidos.' });
      return;
    }
    const { status, assigned, provider, search, limit = 50 } = parsed.data;
    const workspaceId = req.auth!.workspace.id;
    const version = await getVersion(`hm:ws:v:${workspaceId}`);
    const filterHash = JSON.stringify({ status, assigned, provider, search, limit });
    const key = `hm:conv:list:${workspaceId}:v${version}:${filterHash}`;

    const rows = await cached(key, 120, () =>
      req.scoped!(async (tx) => {
        const conds: SQL[] = [];
        if (status) conds.push(eq(schema.conversations.status, status));
        if (assigned) conds.push(eq(schema.conversations.assignedTo, assigned));
        if (provider) conds.push(eq(schema.channels.provider, provider));
        if (search) conds.push(ilike(schema.conversations.lastMessagePreview, `%${search}%`));
        const where = conds.length ? and(...conds) : undefined;
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
