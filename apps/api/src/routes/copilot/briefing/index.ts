/**
 * `/api/copilot/briefing*` — F73-S12 (A2; COPILOTO.md §5.2 e §7.1).
 *
 *   GET  /api/copilot/briefing/today        gera (primeira abertura do dia) ou reconfere (> 60 min)
 *                                           e devolve o `Briefing` do contrato.
 *   POST /api/copilot/briefing/today/seen   grava `seen_at` e `briefing_last_seen_on`: é o que a
 *                                           interface usa para abrir o balão UMA vez por dia.
 *
 * Montado por `createCopilotRouter` depois da porta `requireAuth → withRLS → copilotAvailable`
 * (view-as, Copiloto desligado, papel desligado). Permissão: `copilot.use`. O briefing é
 * pessoal: o escopo (AGENT só vê o que é dele) é aplicado dentro da geração.
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { copilotBriefingsRepo, copilotMemberPrefsRepo } from '@hm/db';
import { requireRole } from '../../../middlewares/auth';
import { rateLimit } from '../../../middlewares/rate-limit';
import { loadWorkspaceFormat } from '../../../internal/copilot/read-crm/common';
import { resolveCopilotPrincipal } from '../../../services/copilot/identity/principal';
import { getOrCreateToday, localDateOf } from '../../../services/copilot/briefing/generate';

export const BRIEFING_READ_RATE_LIMIT = { max: 60, windowSec: 60 } as const;
export const BRIEFING_SEEN_RATE_LIMIT = { max: 30, windowSec: 60 } as const;

export interface CopilotBriefingRouterOptions {
  /** Relógio injetável (testes). */
  readonly now?: () => Date;
}

/** Rate limit por MEMBRO (o middleware existente, com o membro no `bucket`). */
function memberLimit(name: string, limit: { max: number; windowSec: number }): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const memberId = req.auth?.member.id ?? 'anon';
    rateLimit({
      bucket: `${name}:${memberId}`,
      max: limit.max,
      windowSec: limit.windowSec,
      byEmail: false,
    })(req, res, next);
  };
}

function forbidden(res: Response): void {
  res.status(403).json({ error: 'forbidden', message: 'Sem permissão para esta ação.' });
}

export function createCopilotBriefingRouter(options: CopilotBriefingRouterOptions = {}): Router {
  const router = Router();
  const clock = options.now ?? (() => new Date());
  const canUse = requireRole('copilot.use');
  const readLimit = memberLimit('copilot-briefing-read', BRIEFING_READ_RATE_LIMIT);
  const seenLimit = memberLimit('copilot-briefing-seen', BRIEFING_SEEN_RATE_LIMIT);

  // GET /api/copilot/briefing/today
  router.get(
    '/api/copilot/briefing/today',
    canUse,
    readLimit,
    async (req: Request, res: Response) => {
      const auth = req.auth;
      if (!auth) return forbidden(res);
      const now = clock();
      const out = await req.scoped!(async (tx) => {
        const principal = await resolveCopilotPrincipal(tx, {
          workspaceId: auth.workspace.id,
          memberId: auth.member.id,
          now,
        });
        if (!principal) return null;
        return getOrCreateToday(tx, principal, { now });
      });
      if (!out) return forbidden(res);
      // Pessoal e com hora: nunca em cache de intermediário.
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(out.briefing);
    },
  );

  // POST /api/copilot/briefing/today/seen
  router.post(
    '/api/copilot/briefing/today/seen',
    canUse,
    seenLimit,
    async (req: Request, res: Response) => {
      const auth = req.auth;
      if (!auth) return forbidden(res);
      const now = clock();
      const out = await req.scoped!(async (tx) => {
        const fmt = await loadWorkspaceFormat(tx, auth.workspace.id);
        const forDate = localDateOf(now, fmt.timezone);
        const row = await copilotBriefingsRepo.markSeen(tx, auth.member.id, forDate);
        if (!row) return null;
        await copilotMemberPrefsRepo.upsert(tx, {
          workspaceId: auth.workspace.id,
          memberId: auth.member.id,
          patch: { briefingLastSeenOn: forDate },
        });
        return { for_date: forDate, seen_at: row.seenAt ? row.seenAt.toISOString() : null };
      });
      if (!out) {
        res.status(404).json({
          error: 'briefing_not_found',
          message: 'Não há briefing de hoje para marcar como visto. Abra o Copiloto primeiro.',
        });
        return;
      }
      res.status(200).json(out);
    },
  );

  return router;
}
