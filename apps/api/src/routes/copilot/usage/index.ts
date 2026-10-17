/**
 * `/api/copilot/usage` e `/api/copilot/insights` — F73-S15 (COPILOTO.md P7, P8, §5.2, §9).
 *
 *   GET /api/copilot/usage      (`copilot.view_costs`)  mês corrente: gasto, teto, série diária,
 *                                                       top 5 membros por custo, turnos e ações
 *   GET /api/copilot/insights   (`copilot.manage`)      métricas de produto da empresa (§9), só
 *                                                       contagens e taxas, sem conteúdo
 *
 * Montado por `createCopilotRouter` DEPOIS da porta `requireAuth → withRLS → copilotAvailable`
 * (view-as, papel, Copiloto desligado). A permissão fina é de cada rota: AGENT, SUPERVISOR e
 * READONLY recebem 403. Leitura apenas (sem `Idempotency-Key`; o guard de assinatura deixa GET
 * passar). `Cache-Control: no-store`: custo é dado financeiro da empresa e não vai a cache de
 * intermediário. O custo é devolvido em US$ (moeda do `llm_usage_logs`); formatar em R$ depende
 * da decisão de preço e é da interface.
 */
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { copilotSettingsRepo } from '@hm/db';
import { rateLimit } from '../../../middlewares/rate-limit';
import { requireRole } from '../../../middlewares/auth';
import { sanitizeCapabilityMatrix } from '../../../services/copilot/identity/principal';
import { loadCopilotInsights, loadCopilotUsage } from '../../../services/copilot/usage';

/** Leitura agregada (várias consultas): 30/min por membro basta para uma tela de gestão. */
export const USAGE_READ_RATE_LIMIT = { max: 30, windowSec: 60 } as const;

function memberRateLimit(bucket: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const memberId = req.auth?.member.id ?? 'anon';
    rateLimit({
      bucket: `${bucket}:${memberId}`,
      max: USAGE_READ_RATE_LIMIT.max,
      windowSec: USAGE_READ_RATE_LIMIT.windowSec,
      byEmail: false,
    })(req, res, next);
  };
}

export interface CopilotUsageRouterOptions {
  /** Relógio (testes). */
  readonly now?: () => Date;
}

export function createCopilotUsageRouter(options: CopilotUsageRouterOptions = {}): Router {
  const router = Router();
  const clock = options.now ?? (() => new Date());
  const canViewCosts = requireRole('copilot.view_costs');
  const canManage = requireRole('copilot.manage');

  router.get(
    '/api/copilot/usage',
    canViewCosts,
    memberRateLimit('copilot-usage'),
    async (req: Request, res: Response) => {
      const workspaceId = req.auth!.workspace.id;
      const at = clock();
      const usage = await req.scoped!(async (tx) => {
        const settings = req.copilot?.settings ?? (await copilotSettingsRepo.get(tx, workspaceId));
        return loadCopilotUsage(tx, workspaceId, settings, at);
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(usage);
    },
  );

  router.get(
    '/api/copilot/insights',
    canManage,
    memberRateLimit('copilot-insights'),
    async (req: Request, res: Response) => {
      const workspaceId = req.auth!.workspace.id;
      const at = clock();
      const insights = await req.scoped!(async (tx) => {
        const settings = req.copilot?.settings ?? (await copilotSettingsRepo.get(tx, workspaceId));
        return loadCopilotInsights(
          tx,
          workspaceId,
          sanitizeCapabilityMatrix(settings.capabilityMatrix),
          at,
        );
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(insights);
    },
  );

  return router;
}
