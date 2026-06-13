/**
 * API de plataforma -- sessoes de view-as / impersonation (F26-S05, secao 6).
 *
 *   POST   /api/platform/impersonation       inicia ({ workspaceId, reason }) -> seta cookie
 *   DELETE /api/platform/impersonation/:id    encerra (kill-switch) -> limpa cookie
 *   GET    /api/platform/impersonation        lista sessoes ativas
 *
 * Decisao travada: SO view-as read-only (mode='view'). Operacao sensivel (acesso a PII
 * do titular -- LGPD): `reason` OBRIGATORIO, TTL curto, inicio/fim em audit_logs. Gated
 * por requirePlatformAdmin. O middleware (impersonation.ts) consome o cookie e impoe o
 * read-only. Wire em app.ts e do orchestrator.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getDb, impersonationSessionsRepo, schema, workspacesRepo } from '@hm/db';
import { requirePlatformAdmin } from '../../middlewares/platform-admin';
import { IMPERSONATION_COOKIE } from '../../middlewares/impersonation';

const { auditLogs } = schema;

/** TTL da sessao view-as: 30 minutos (secao 6.1). */
const TTL_MS = 30 * 60 * 1000;
const isProd = process.env['NODE_ENV'] === 'production';

const startSchema = z
  .object({
    workspaceId: z.string().uuid(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();

const idParam = z.string().uuid();

function clientIp(req: Request): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
  return req.ip ?? null;
}

async function audit(
  req: Request,
  action: string,
  targetWorkspaceId: string,
  resourceId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const member = req.auth?.member;
  try {
    await getDb()
      .insert(auditLogs)
      .values({
        workspaceId: targetWorkspaceId,
        actorMemberId: member?.id ?? null,
        actorType: 'platform_admin',
        action,
        resourceType: 'impersonation_session',
        resourceId,
        metadata,
        ipAddress: clientIp(req),
        userAgent: req.headers['user-agent'] ?? null,
      });
  } catch {
    // best-effort
  }
}

export function createPlatformImpersonationRouter(): Router {
  const router = Router();

  // ─── POST inicia uma sessao view-as ─────────────────────────────────────────
  router.post(
    '/api/platform/impersonation',
    ...requirePlatformAdmin,
    async (req: Request, res: Response) => {
      const parsed = startSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
        return;
      }
      const { workspaceId, reason } = parsed.data;

      const target = await workspacesRepo.findById(workspaceId);
      if (!target) {
        res.status(404).json({ error: 'workspace_not_found' });
        return;
      }

      const adminMemberId = req.auth!.member.id;
      const expiresAt = new Date(Date.now() + TTL_MS);
      const session = await impersonationSessionsRepo.create({
        adminMemberId,
        targetWorkspaceId: workspaceId,
        reason,
        expiresAt,
        ipAddress: clientIp(req),
        userAgent: req.headers['user-agent'] ?? null,
      });

      await audit(req, 'impersonation.started', workspaceId, session.id, {
        reason,
        mode: 'view',
        expiresAt: expiresAt.toISOString(),
      });

      // Cookie de claim, separado da sessao normal. httpOnly + sameSite lax; TTL casa.
      res.cookie(IMPERSONATION_COOKIE, session.id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
        maxAge: TTL_MS,
      });

      res.status(201).json({
        session: {
          id: session.id,
          targetWorkspaceId: workspaceId,
          targetWorkspaceName: target.name,
          mode: 'view',
          reason,
          startedAt: session.startedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      });
    },
  );

  // ─── DELETE encerra (kill-switch) ───────────────────────────────────────────
  router.delete(
    '/api/platform/impersonation/:id',
    ...requirePlatformAdmin,
    async (req: Request, res: Response) => {
      const id = idParam.safeParse(req.params['id']);
      if (!id.success) {
        res.status(400).json({ error: 'invalid_id' });
        return;
      }
      const session = await impersonationSessionsRepo.findById(id.data);
      if (!session) {
        res.status(404).json({ error: 'session_not_found' });
        return;
      }
      // So o admin dono encerra a propria sessao.
      if (session.adminMemberId !== req.auth!.member.id) {
        res.status(403).json({ error: 'not_session_owner' });
        return;
      }
      const ended = await impersonationSessionsRepo.end(id.data, new Date());
      await audit(req, 'impersonation.ended', session.targetWorkspaceId, session.id, {
        wasActive: ended !== null,
      });
      res.clearCookie(IMPERSONATION_COOKIE, { path: '/' });
      res.json({ ended: true });
    },
  );

  // ─── GET sessoes ativas ─────────────────────────────────────────────────────
  router.get(
    '/api/platform/impersonation',
    ...requirePlatformAdmin,
    async (_req: Request, res: Response) => {
      const sessions = await impersonationSessionsRepo.listActive(new Date());
      res.json({
        sessions: sessions.map((s) => ({
          id: s.id,
          adminMemberId: s.adminMemberId,
          targetWorkspaceId: s.targetWorkspaceId,
          mode: s.mode,
          reason: s.reason,
          startedAt: s.startedAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
        })),
      });
    },
  );

  return router;
}
