/**
 * Audit log viewer (F8-S08, DATA_MODEL §14.1). Lista `audit_logs` do workspace,
 * filtrável, sob RLS (a policy audit_logs_isolation já restringe ao tenant).
 *
 *   GET /api/audit?action=&resourceType=&actorMemberId=&from=&to=&page=&pageSize=
 *
 * Gated por workspace.edit (ADMINS) — auditoria é dado sensível de administração.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { schema } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../middlewares/auth';

const { auditLogs, members } = schema;

const querySchema = z.object({
  action: z.string().trim().max(120).optional(),
  resourceType: z.string().trim().max(120).optional(),
  actorMemberId: z.string().uuid().optional(),
  actorType: z.enum(['member', 'agent', 'api', 'system', 'platform_admin']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export function createAuditRouter(): Router {
  const router = Router();
  const guard = [requireAuth, withRLS, requireRole('workspace.edit')] as const;

  router.get('/api/audit', ...guard, async (req: Request, res: Response) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
      return;
    }
    const { action, resourceType, actorMemberId, actorType, from, to, page, pageSize } = parsed.data;

    const conds = [];
    if (action) conds.push(eq(auditLogs.action, action));
    if (resourceType) conds.push(eq(auditLogs.resourceType, resourceType));
    if (actorMemberId) conds.push(eq(auditLogs.actorMemberId, actorMemberId));
    if (actorType) conds.push(eq(auditLogs.actorType, actorType));
    if (from) conds.push(gte(auditLogs.createdAt, new Date(from)));
    if (to) conds.push(lte(auditLogs.createdAt, new Date(to)));
    const where = conds.length > 0 ? and(...conds) : undefined;

    const { rows, total } = await req.scoped!(async (tx) => {
      const rows = await tx
        .select({
          id: auditLogs.id,
          actorMemberId: auditLogs.actorMemberId,
          actorName: members.name,
          actorEmail: members.email,
          actorType: auditLogs.actorType,
          action: auditLogs.action,
          resourceType: auditLogs.resourceType,
          resourceId: auditLogs.resourceId,
          metadata: auditLogs.metadata,
          ipAddress: auditLogs.ipAddress,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .leftJoin(members, eq(members.id, auditLogs.actorMemberId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const countRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(where);
      return { rows, total: countRows[0]?.count ?? 0 };
    });

    res.json({
      logs: rows,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  });

  return router;
}
