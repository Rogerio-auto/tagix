/**
 * `/api/copilot/proposals*` e `/api/copilot/approvers` — F73-S05 (ADR-004; COPILOTO.md §5.2).
 *
 * Montado por `createCopilotRouter` DEPOIS da porta `requireAuth → withRLS → copilotAvailable`:
 * sessão, RLS, guard de assinatura (toda escrita daqui é 402 em só leitura, SEM exceção) e
 * disponibilidade do Copiloto já valeram. Aqui ficam a permissão fina e os códigos estáveis:
 *
 *   200 estado atual · 201 proposta nova (retry) · 202 confirmação aceita (executando)
 *   400 entrada malformada · 402 só leitura · 403 sem permissão
 *   404 não existe ou não é visível (sem oráculo)
 *   409 `already_confirmed` | `stale_proposal` | `not_undoable` | `policy_blocked` | …
 *   410 `proposal_expired` | `undo_window_closed` · 422 `ack_required` | `invalid_adjustment` | …
 *   429 limite: confirmar, desfazer e ajustar, 30/min por membro
 *
 * Quem pode o quê: ver = dono, aprovador, quem executou ou `copilot.activity.view_all`;
 * confirmar = dono (ou o aprovador, com as permissões DELE); ajustar e tentar de novo = dono;
 * cancelar = dono ou aprovador; desfazer = dono ou `copilot.activity.view_all`, sempre com a
 * permissão da capacidade de quem desfaz.
 */
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { z } from 'zod';
import { copilotProposalsRepo, type DbTx } from '@hm/db';
import {
  AdjustProposalBody,
  BATCH_LIMIT,
  CapabilityKeySchema,
  ConfirmProposalBody,
  IdempotencyKeySchema,
  RequestApprovalBody,
  UuidSchema,
  isWriteCapability,
} from '@hm/shared';
import { COPILOT_EXECUTORS } from '../../../internal/copilot';
import type { CapabilityExecutor } from '../../../internal/copilot/core/executor-types';
import { rateLimit } from '../../../middlewares/rate-limit';
import {
  resolveCopilotPrincipal,
  type CopilotPrincipal,
} from '../../../services/copilot/identity/principal';
import {
  PROPOSAL_ERROR_MESSAGES,
  PROPOSAL_ERROR_STATUS,
  adjustProposal,
  buildProposalDTO,
  canViewProposal,
  cancelProposal,
  confirmProposal,
  createExecutorRegistry,
  createProposalEngineDeps,
  listApprovers,
  notifySafely,
  publishProposalState,
  requestApproval,
  retryFailedItems,
  undoProposal,
  type ProposalEngineDeps,
  type ProposalFailure,
} from '../../../services/copilot/proposals';

export interface CopilotProposalsRouterOptions {
  /** Executores registrados. Default: `COPILOT_EXECUTORS` (act-crm + act-external). */
  readonly executors?: readonly CapabilityExecutor[];
  /** Dependências completas do motor (testes). */
  readonly deps?: ProposalEngineDeps;
}

/** Limite de confirmar/desfazer/ajustar por membro (spec §5.2). */
export const PROPOSAL_WRITE_RATE_LIMIT = { max: 30, windowSec: 60 } as const;

/**
 * Rate limit por MEMBRO com o middleware existente (por import): o membro entra no `bucket`, e
 * a chave final fica `rl:copilot-proposal-write:<member>:<ip>`. Um bucket só para as três
 * ações: o limite é do membro, não de cada botão.
 */
function memberRateLimit(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const memberId = req.auth?.member.id ?? 'anon';
    rateLimit({
      bucket: `copilot-proposal-write:${memberId}`,
      max: PROPOSAL_WRITE_RATE_LIMIT.max,
      windowSec: PROPOSAL_WRITE_RATE_LIMIT.windowSec,
      byEmail: false,
    })(req, res, next);
  };
}

function paramId(req: Request): string | null {
  const raw = req.params['id'];
  const id = typeof raw === 'string' ? raw : '';
  return UuidSchema.safeParse(id).success ? id.toLowerCase() : null;
}

export function sendProposalFailure(res: Response, failure: ProposalFailure): void {
  res.status(PROPOSAL_ERROR_STATUS[failure.error]).json({
    error: failure.error,
    message: PROPOSAL_ERROR_MESSAGES[failure.error],
    ...(failure.proposal ? { proposal: failure.proposal } : {}),
  });
}

function notFound(res: Response): void {
  res.status(404).json({ error: 'not_found', message: PROPOSAL_ERROR_MESSAGES.not_found });
}

function badRequest(res: Response, error: string, message: string): void {
  res.status(400).json({ error, message });
}

/** Principal de quem lê, recarregado agora (papel, matriz, assinatura). */
export async function loadViewer(req: Request, tx: DbTx): Promise<CopilotPrincipal | null> {
  const auth = req.auth;
  if (!auth) return null;
  return resolveCopilotPrincipal(tx, { workspaceId: auth.workspace.id, memberId: auth.member.id });
}

function forbidden(res: Response): void {
  res.status(403).json({ error: 'forbidden', message: PROPOSAL_ERROR_MESSAGES.forbidden });
}

export function createCopilotProposalsRouter(options: CopilotProposalsRouterOptions = {}): Router {
  const router = Router();
  let cachedDeps: ProposalEngineDeps | null = options.deps ?? null;
  const deps = (): ProposalEngineDeps =>
    (cachedDeps ??= createProposalEngineDeps({
      executors: createExecutorRegistry(options.executors ?? COPILOT_EXECUTORS),
    }));
  const limited = memberRateLimit();

  // GET /api/copilot/proposals/:id
  router.get('/api/copilot/proposals/:id', async (req: Request, res: Response) => {
    const id = paramId(req);
    if (!id) return notFound(res);
    const out = await req.scoped!(async (tx) => {
      const viewer = await loadViewer(req, tx);
      if (!viewer) return null;
      const loaded = await copilotProposalsRepo.getWithItems(tx, id);
      if (!loaded || !canViewProposal(loaded.proposal, viewer)) return null;
      return buildProposalDTO(tx, loaded.proposal, loaded.items, viewer, deps().now());
    });
    if (!out) return notFound(res);
    res.status(200).json(out);
  });

  // POST /api/copilot/proposals/:id/confirm   (Idempotency-Key)
  router.post(
    '/api/copilot/proposals/:id/confirm',
    limited,
    async (req: Request, res: Response) => {
      const id = paramId(req);
      if (!id) return notFound(res);
      const key = IdempotencyKeySchema.safeParse(req.header('idempotency-key'));
      if (!key.success) {
        return badRequest(
          res,
          'idempotency_key_required',
          'Envie o header Idempotency-Key (UUID).',
        );
      }
      const body = ConfirmProposalBody.safeParse(req.body ?? {});
      if (!body.success) return badRequest(res, 'invalid_body', 'Corpo inválido.');
      const d = deps();
      const out = await req.scoped!(async (tx) => {
        const viewer = await loadViewer(req, tx);
        if (!viewer) return null;
        return confirmProposal(d, tx, viewer, id, { ...body.data, idempotencyKey: key.data });
      });
      if (!out) return forbidden(res);
      if (!out.ok) return sendProposalFailure(res, out);
      res.status(out.status).json(out.proposal);
      // Depois do commit: executa, avisa o socket e, na aprovação, o solicitante.
      if (out.start) void out.start();
      if (out.status === 202) await publishProposalState(d, out.row, out.items);
      await notifySafely(d, out.notification);
    },
  );

  // POST /api/copilot/proposals/:id/adjust
  router.post('/api/copilot/proposals/:id/adjust', limited, async (req: Request, res: Response) => {
    const id = paramId(req);
    if (!id) return notFound(res);
    const body = AdjustProposalBody.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(422).json({
        error: 'invalid_adjustment',
        message: PROPOSAL_ERROR_MESSAGES.invalid_adjustment,
      });
      return;
    }
    const d = deps();
    const out = await req.scoped!(async (tx) => {
      const viewer = await loadViewer(req, tx);
      if (!viewer) return null;
      return adjustProposal(d, tx, viewer, id, body.data);
    });
    if (!out) return forbidden(res);
    if (!out.ok) return sendProposalFailure(res, out);
    res.status(200).json(out.proposal);
    await publishProposalState(d, out.row, out.items);
  });

  // POST /api/copilot/proposals/:id/cancel   (antes de executar = cancelar; executando = Parar)
  router.post('/api/copilot/proposals/:id/cancel', async (req: Request, res: Response) => {
    const id = paramId(req);
    if (!id) return notFound(res);
    const d = deps();
    const out = await req.scoped!(async (tx) => {
      const viewer = await loadViewer(req, tx);
      if (!viewer) return null;
      return cancelProposal(d, tx, viewer, id);
    });
    if (!out) return forbidden(res);
    if (!out.ok) return sendProposalFailure(res, out);
    res.status(200).json(out.proposal);
    await publishProposalState(d, out.row, out.items);
    await notifySafely(d, out.notification);
  });

  // POST /api/copilot/proposals/:id/undo   (Idempotency-Key)
  router.post('/api/copilot/proposals/:id/undo', limited, async (req: Request, res: Response) => {
    const id = paramId(req);
    if (!id) return notFound(res);
    const key = IdempotencyKeySchema.safeParse(req.header('idempotency-key'));
    if (!key.success) {
      return badRequest(res, 'idempotency_key_required', 'Envie o header Idempotency-Key (UUID).');
    }
    const scoped = req.scoped!;
    const viewer = await scoped((tx) => loadViewer(req, tx));
    if (!viewer) return forbidden(res);
    const out = await undoProposal(deps(), viewer, id, key.data, scoped);
    if (!out.ok) return sendProposalFailure(res, out);
    res.status(200).json(out.proposal);
  });

  // POST /api/copilot/proposals/:id/retry-failed → proposta NOVA
  router.post('/api/copilot/proposals/:id/retry-failed', async (req: Request, res: Response) => {
    const id = paramId(req);
    if (!id) return notFound(res);
    const out = await req.scoped!(async (tx) => {
      const viewer = await loadViewer(req, tx);
      if (!viewer) return null;
      return retryFailedItems(deps(), tx, viewer, id);
    });
    if (!out) return forbidden(res);
    if (!out.ok) return sendProposalFailure(res, out);
    res.status(201).json(out.proposal);
  });

  // POST /api/copilot/proposals/:id/request-approval
  router.post(
    '/api/copilot/proposals/:id/request-approval',
    async (req: Request, res: Response) => {
      const id = paramId(req);
      if (!id) return notFound(res);
      const body = RequestApprovalBody.safeParse(req.body ?? {});
      if (!body.success) return badRequest(res, 'invalid_body', 'Corpo inválido.');
      const d = deps();
      const out = await req.scoped!(async (tx) => {
        const viewer = await loadViewer(req, tx);
        if (!viewer) return null;
        return requestApproval(d, tx, viewer, id, body.data.approver_member_id);
      });
      if (!out) return forbidden(res);
      if (!out.ok) return sendProposalFailure(res, out);
      res.status(200).json(out.proposal);
      await publishProposalState(d, out.row, out.items);
      await notifySafely(d, out.notification);
    },
  );

  // GET /api/copilot/approvers?capability=&count=
  const approversQuery = z
    .object({
      capability: CapabilityKeySchema,
      count: z.coerce.number().int().min(1).max(BATCH_LIMIT).optional(),
    })
    .strict();
  router.get('/api/copilot/approvers', async (req: Request, res: Response) => {
    const query = approversQuery.safeParse(req.query);
    if (!query.success || !isWriteCapability(query.data.capability)) {
      return badRequest(res, 'invalid_query', 'Informe uma capacidade de escrita.');
    }
    const { capability, count } = query.data;
    const out = await req.scoped!(async (tx) => {
      const viewer = await loadViewer(req, tx);
      if (!viewer) return null;
      return listApprovers(tx, viewer, capability, count ?? 1);
    });
    if (!out) return forbidden(res);
    res.status(200).json({ data: out });
  });

  return router;
}
