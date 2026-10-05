import type { NextFunction, Request, Response } from 'express';
import { withWorkspace, type DbTx } from '@hm/db';
import { can, type Permission, type Role } from '@hm/shared';
import { readPreferredWorkspace, readToken, resolveSessionStatus } from '../auth';
import { requireActiveSubscription } from './subscription-guard';

/**
 * Exige sessão válida; popula `req.auth` (member + workspace). A empresa é a do cookie
 * `hm_workspace` quando a pessoa tem membership `active` nela; senão a última usada
 * (F71-S03). Cookie de empresa inválida é ignorado, nunca vira erro.
 */
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
  const result = token
    ? await resolveSessionStatus(token, readPreferredWorkspace(req))
    : ({ kind: 'invalid' } as const);
  if (result.kind === 'unavailable') {
    // F70-S28: provider de auth fora do ar (sem cache recente) NÃO é sessão morta.
    // 401 aqui mandaria todo mundo para o login a cada instabilidade do Supabase.
    res.status(503).json({
      message: 'Não foi possível confirmar sua sessão agora. Tente de novo em instantes.',
      error: 'auth_unavailable',
    });
    return;
  }
  if (result.kind === 'invalid') {
    // `error` estável: o web trata este 401 como "sessão terminou" (volta ao login).
    res.status(401).json({ message: 'Não autenticado.', error: 'session_invalid' });
    return;
  }
  req.auth = result.session;
  next();
}

/**
 * Disponibiliza `req.scoped(fn)` — roda `fn` numa transação com RLS do workspace.
 *
 * Também aplica o modo só leitura por assinatura (F71-S06): empresa `expired`/`canceled`
 * recebe 402 em escrita, salvo as exceções de `subscription-guard.ts`. Fica aqui porque
 * toda rota escopada por empresa passa por `withRLS` depois do `requireAuth` — uma guarda
 * só cobre todas, sem depender de cada router lembrar dela.
 */
export function withRLS(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ message: 'Não autenticado.' });
    return;
  }
  const workspaceId = req.auth.workspace.id;
  req.scoped = <T>(fn: (tx: DbTx) => Promise<T>) => withWorkspace<T>(workspaceId, fn);
  requireActiveSubscription(req, res, next);
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
