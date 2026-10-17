/**
 * `copilotAvailable`: a porta de TODA rota pública `/api/copilot/*` (ADR-003 §5; COPILOTO.md
 * §5.2). Roda depois de `requireAuth → withRLS`, na ordem:
 *
 *   1. view-as (impersonation)          → 403 `copilot_unavailable_impersonation`
 *      As conversas do Copiloto são privadas do membro e o view-as não pode lê-las; também
 *      não se gasta o orçamento do tenant em nome de um admin da plataforma. Vale para GET.
 *   2. `requireRole('copilot.use')`     → 403
 *   3. `copilot_settings.enabled=false` → 403 `copilot_disabled`
 *   4. `matriz[role].use = false`       → 403 `copilot_disabled_for_role`
 *
 * Exceções deliberadas:
 * - `/settings` (A11) não passa pelos passos 3 e 4: quem desliga o Copiloto precisa da tela
 *   para religá-lo. A rota exige `copilot.manage` por conta própria.
 * - `GET /me` não passa pelo passo 4: é ele que conta à interface que o papel está sem
 *   acesso (`available: false`, `unavailable_reason: 'disabled_for_role'`).
 *
 * A configuração lida aqui fica em `req.copilot.settings`: `GET /me` reaproveita a leitura
 * (orçamento de 3 queries por request, F74-S01).
 */
import type { NextFunction, Request, Response } from 'express';
import { copilotSettingsRepo, type CopilotSettingsView } from '@hm/db';
import { ROLES, copilotAccessFor, type Role } from '@hm/shared';
import { requireRole } from '../../../middlewares/auth';
import { sanitizeCapabilityMatrix } from './principal';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Presente nas rotas `/api/copilot/*` depois de `copilotAvailable`. */
      copilot?: { readonly settings: CopilotSettingsView };
    }
  }
}

/** Corpos estáveis das recusas (o web lê `error`). */
export const COPILOT_UNAVAILABLE_ERRORS = {
  impersonation: 'copilot_unavailable_impersonation',
  disabled: 'copilot_disabled',
  disabledForRole: 'copilot_disabled_for_role',
} as const;

const ROLE_SET: ReadonlySet<string> = new Set(ROLES);
const requireCopilotUse = requireRole('copilot.use');

/** Caminho relativo à montagem `/api/copilot`, sem query, em minúsculas (Express ignora caixa). */
function relativePath(req: Request): string {
  return req.path.toLowerCase().replace(/\/+$/, '') || '/';
}

function isSettingsPath(path: string): boolean {
  return path === '/settings' || path.startsWith('/settings/');
}

/** Middleware. Montar com `router.use('/api/copilot', requireAuth, withRLS, copilotAvailable)`. */
export async function copilotAvailable(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.impersonation) {
    res.status(403).json({
      error: COPILOT_UNAVAILABLE_ERRORS.impersonation,
      message: 'O Copiloto não fica disponível no modo de visualização como cliente.',
    });
    return;
  }

  let roleOk = false;
  requireCopilotUse(req, res, () => {
    roleOk = true;
  });
  if (!roleOk) return;

  const auth = req.auth;
  const scoped = req.scoped;
  if (!auth || !scoped) {
    res.status(401).json({ message: 'Não autenticado.', error: 'session_invalid' });
    return;
  }

  const settings = await scoped((tx) => copilotSettingsRepo.get(tx, auth.workspace.id));
  req.copilot = { settings };

  const path = relativePath(req);
  if (isSettingsPath(path)) {
    next();
    return;
  }

  if (!settings.enabled) {
    res.status(403).json({
      error: COPILOT_UNAVAILABLE_ERRORS.disabled,
      message: 'O Copiloto está desligado nesta empresa.',
    });
    return;
  }

  const role = auth.member.role;
  if (ROLE_SET.has(role) && !(req.method === 'GET' && path === '/me')) {
    const access = copilotAccessFor(
      role as Role,
      sanitizeCapabilityMatrix(settings.capabilityMatrix),
    );
    if (!access.allowed) {
      res.status(403).json({
        error: COPILOT_UNAVAILABLE_ERRORS.disabledForRole,
        message: 'O Copiloto está desligado para o seu papel nesta empresa.',
      });
      return;
    }
  }

  next();
}
