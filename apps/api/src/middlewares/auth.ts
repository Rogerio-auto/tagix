import type { NextFunction, Request, Response } from 'express';
import { withWorkspace, type DbTx } from '@hm/db';
import { can, type Permission, type Role } from '@hm/shared';
import { readToken, resolveSession } from '../auth';

/** Exige sessão válida; popula `req.auth` (member + workspace). */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // View-as (F26-S05): quando o middleware de impersonation já resolveu a sessão do
  // admin e sobrepôs o workspace pelo ALVO (req.impersonation presente + req.auth setado),
  // NÃO re-resolvemos — isso preservaria o contexto do tenant impersonado em vez de
  // clobberar de volta para o workspace do admin. Fora de impersonation, comportamento
  // inalterado (re-resolve por request).
  if (req.impersonation && req.auth) {
    next();
    return;
  }
  const token = readToken(req);
  const session = token ? await resolveSession(token) : null;
  if (!session) {
    res.status(401).json({ message: 'Não autenticado.' });
    return;
  }
  req.auth = session;
  next();
}

/** Disponibiliza `req.scoped(fn)` — roda `fn` numa transação com RLS do workspace. */
export function withRLS(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ message: 'Não autenticado.' });
    return;
  }
  const workspaceId = req.auth.workspace.id;
  req.scoped = <T>(fn: (tx: DbTx) => Promise<T>) => withWorkspace<T>(workspaceId, fn);
  next();
}

/** Autoriza pela matriz `can()`. Usar após `requireAuth`. */
export function requireRole(perm: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.auth?.member.role as Role | undefined;
    if (!role || !can(role, perm)) {
      res.status(403).json({ message: 'Sem permissão para esta ação.' });
      return;
    }
    next();
  };
}
