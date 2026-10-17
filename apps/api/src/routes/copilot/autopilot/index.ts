/**
 * `/api/copilot/autopilot/rules` e `/api/copilot/suggestions*` — F73-S13 (A9; COPILOTO.md §5.2).
 *
 *   GET  /api/copilot/autopilot/rules         `pipeline.view`            regras gravadas por estágio
 *   PUT  /api/copilot/autopilot/rules         `copilot.autopilot.manage` grava o lote (tudo ou nada)
 *   GET  /api/copilot/suggestions             `pipeline.view`            fila, sob o escopo do membro
 *   POST /api/copilot/suggestions/decide      `deal.move`                aprovar ou recusar em lote
 *
 * Montado por `createCopilotRouter` DEPOIS da porta `requireAuth → withRLS → copilotAvailable`:
 * sessão, RLS, guard de assinatura (escrita é 402 em só leitura), view-as (escrita é 403) e
 * Copiloto ligado já valeram. Aqui ficam a permissão fina, a validação e os códigos estáveis:
 *
 *   200 ok · 400 `invalid_body` | `invalid_query` | `invalid_cursor` · 403 sem permissão
 *   409 `feature_not_available` ("mover sozinho", v1.1) · 422 `invalid_rule`
 *   429 limite por membro (decidir 30/min, regras 20/min)
 *
 * Aprovar executa pelo motor de propostas como QUEM APROVOU (ver `services/copilot/autopilot/decide`).
 */
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { z } from 'zod';
import { InvalidCursorError } from '@hm/db';
import {
  AutopilotRulesUpdateBody,
  COPILOT_SUGGESTION_STATUSES,
  DecideSuggestionsBody,
  UuidSchema,
} from '@hm/shared';
import { COPILOT_EXECUTORS } from '../../../internal/copilot';
import type { CapabilityExecutor } from '../../../internal/copilot/core/executor-types';
import { moveDealsExecutor } from '../../../internal/copilot/act-crm/move-deals';
import { requireRole } from '../../../middlewares/auth';
import { rateLimit } from '../../../middlewares/rate-limit';
import {
  RULES_FAILURE_MESSAGES,
  DECIDE_EXECUTION_WAIT_MS,
  countPendingSuggestions,
  decideSuggestions,
  emitSuggestionsChangedSafely,
  listAutopilotRules,
  listSuggestions,
  relaySuggestionsChanged,
  updateAutopilotRules,
  type SuggestionsChangedEmitter,
} from '../../../services/copilot/autopilot';
import { resolveCopilotPrincipal } from '../../../services/copilot/identity/principal';
import {
  createExecutorRegistry,
  createProposalEngineDeps,
  type ProposalEngineDeps,
} from '../../../services/copilot/proposals';

export const AUTOPILOT_DECIDE_RATE_LIMIT = { max: 30, windowSec: 60 } as const;
export const AUTOPILOT_RULES_RATE_LIMIT = { max: 20, windowSec: 60 } as const;

export interface CopilotAutopilotRouterOptions {
  /** Dependências completas do motor (testes). */
  readonly deps?: ProposalEngineDeps;
  /** Executores registrados no motor. Default: `COPILOT_EXECUTORS`. */
  readonly executors?: readonly CapabilityExecutor[];
  /** Emissor de `copilot:suggestions_changed` (testes). */
  readonly emit?: SuggestionsChangedEmitter;
  /** Quanto esperar a execução antes de responder "em andamento" (testes). */
  readonly decideWaitMs?: number;
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

const SuggestionsQuery = z
  .object({
    status: z.enum(COPILOT_SUGGESTION_STATUSES).default('pending'),
    stage_id: UuidSchema.optional(),
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

export function createCopilotAutopilotRouter(options: CopilotAutopilotRouterOptions = {}): Router {
  const router = Router();
  let cachedDeps: ProposalEngineDeps | null = options.deps ?? null;
  const engine = (): ProposalEngineDeps =>
    (cachedDeps ??= createProposalEngineDeps({
      executors: createExecutorRegistry(options.executors ?? COPILOT_EXECUTORS),
    }));
  const emit = options.emit ?? relaySuggestionsChanged;
  const decideLimit = memberLimit('copilot-autopilot-decide', AUTOPILOT_DECIDE_RATE_LIMIT);
  const rulesLimit = memberLimit('copilot-autopilot-rules', AUTOPILOT_RULES_RATE_LIMIT);

  // GET /api/copilot/autopilot/rules
  router.get(
    '/api/copilot/autopilot/rules',
    requireRole('pipeline.view'),
    async (req: Request, res: Response) => {
      const data = await req.scoped!((tx) => listAutopilotRules(tx));
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ data });
    },
  );

  // PUT /api/copilot/autopilot/rules
  router.put(
    '/api/copilot/autopilot/rules',
    requireRole('copilot.autopilot.manage'),
    rulesLimit,
    async (req: Request, res: Response) => {
      const auth = req.auth;
      if (!auth) return forbidden(res);
      const body = AutopilotRulesUpdateBody.safeParse(req.body ?? {});
      if (!body.success) {
        res.status(400).json({ error: 'invalid_body', message: 'Corpo inválido.' });
        return;
      }
      const out = await req.scoped!(async (tx) => {
        const result = await updateAutopilotRules(
          tx,
          { workspaceId: auth.workspace.id, memberId: auth.member.id },
          body.data,
        );
        if (!result.ok) return result;
        return { ...result, pending: await countPendingSuggestions(tx, auth.workspace.id) };
      });
      if (!out.ok) {
        if (out.error === 'feature_not_available') {
          res
            .status(409)
            .json({ error: out.error, message: RULES_FAILURE_MESSAGES.feature_not_available });
        } else if (out.error === 'duplicate_stage') {
          res.status(422).json({
            error: 'invalid_rule',
            reason: out.error,
            message: RULES_FAILURE_MESSAGES.duplicate_stage,
          });
        } else {
          res.status(422).json({
            error: 'invalid_rule',
            stage_id: out.stageId,
            reason: out.reason,
            message: RULES_FAILURE_MESSAGES[out.reason],
          });
        }
        return;
      }
      res.status(200).json({ data: out.rules });
      if (out.superseded > 0) {
        await emitSuggestionsChangedSafely(emit, auth.workspace.id, out.pending);
      }
    },
  );

  // GET /api/copilot/suggestions?status=pending&stage_id=&cursor=&limit=
  router.get(
    '/api/copilot/suggestions',
    requireRole('pipeline.view'),
    async (req: Request, res: Response) => {
      const auth = req.auth;
      if (!auth) return forbidden(res);
      const query = SuggestionsQuery.safeParse(req.query);
      if (!query.success) {
        res.status(400).json({ error: 'invalid_query', message: 'Parâmetros inválidos.' });
        return;
      }
      try {
        const page = await req.scoped!(async (tx) => {
          const principal = await resolveCopilotPrincipal(tx, {
            workspaceId: auth.workspace.id,
            memberId: auth.member.id,
          });
          if (!principal) return null;
          return listSuggestions(tx, principal, {
            status: query.data.status,
            stageId: query.data.stage_id,
            cursor: query.data.cursor,
            limit: query.data.limit,
          });
        });
        if (!page) return forbidden(res);
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(page);
      } catch (err) {
        if (err instanceof InvalidCursorError) {
          res.status(400).json({ error: 'invalid_cursor', message: 'Cursor inválido.' });
          return;
        }
        throw err;
      }
    },
  );

  // POST /api/copilot/suggestions/decide
  router.post(
    '/api/copilot/suggestions/decide',
    requireRole('deal.move'),
    decideLimit,
    async (req: Request, res: Response) => {
      const auth = req.auth;
      if (!auth) return forbidden(res);
      const body = DecideSuggestionsBody.safeParse(req.body ?? {});
      if (!body.success) {
        res.status(400).json({ error: 'invalid_body', message: 'Corpo inválido.' });
        return;
      }
      const scoped = req.scoped!;
      const principal = await scoped((tx) =>
        resolveCopilotPrincipal(tx, {
          workspaceId: auth.workspace.id,
          memberId: auth.member.id,
        }),
      );
      if (!principal) return forbidden(res);
      const result = await decideSuggestions(
        {
          engine: engine(),
          executor: moveDealsExecutor,
          emit,
          scoped,
          waitMs: options.decideWaitMs ?? DECIDE_EXECUTION_WAIT_MS,
        },
        principal,
        {
          ids: [...new Set(body.data.ids.map((id) => id.toLowerCase()))],
          decision: body.data.decision,
        },
      );
      res.status(200).json(result);
    },
  );

  return router;
}
