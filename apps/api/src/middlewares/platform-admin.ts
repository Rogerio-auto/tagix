/**
 * Guard de plataforma (F25-S01, PERMISSIONS.md nível plataforma) —
 * `requirePlatformAdmin`.
 *
 * A camada de super-admin NÃO é workspace-scoped (sem RLS de tenant): este guard
 * é a ÚNICA fronteira de acesso da API de plataforma. Por isso vem antes de tudo
 * (S02–S05 montam seus routers atrás dele).
 *
 * Reusa `requireAuth` (resolve a sessão e popula `req.auth`); em cima dele exige
 * `member.isPlatformAdmin = true`. Acesso negado de um usuário autenticado vai a
 * `audit_logs` (actor_type 'platform_admin') — trilha de tentativas de acesso à
 * camada mais sensível do produto. Sem sessão → 401 (silencioso, sem audit: não
 * há actor).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getDb, schema } from '@hm/db';
import { requireAuth } from './auth';

const { auditLogs } = schema;

/** Grava a tentativa de acesso negado à camada de plataforma (best-effort). */
async function auditDenied(req: Request): Promise<void> {
  const member = req.auth?.member;
  if (!member) return;
  try {
    await getDb()
      .insert(auditLogs)
      .values({
        workspaceId: member.workspaceId,
        actorMemberId: member.id,
        actorType: 'platform_admin',
        action: 'platform.access_denied',
        resourceType: 'platform',
        metadata: { path: req.originalUrl, method: req.method },
      });
  } catch {
    // Auditoria é best-effort; nunca derruba o fluxo de negação.
  }
}

/**
 * Exige uma sessão autenticada cujo member seja `is_platform_admin`.
 * 401 (sem sessão) / 403 (autenticado sem privilégio, auditado) / next() (ok).
 *
 * Exportado para os slots S02–S05 montarem seus routers de plataforma.
 */
export const requirePlatformAdmin: RequestHandler[] = [
  requireAuth,
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth?.member.isPlatformAdmin) {
      void auditDenied(req);
      res.status(403).json({ message: 'Acesso restrito a administradores de plataforma.' });
      return;
    }
    next();
  },
];
