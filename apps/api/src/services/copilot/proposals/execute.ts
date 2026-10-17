/**
 * Execução de uma proposta confirmada (ADR-004 §3): item a item, determinística, retomável.
 *
 * - Cada item roda na SUA transação RLS (`withWorkspace`), com o efeito de domínio num savepoint
 *   do executor. Status do item e escrita de domínio entram juntos ou não entram: um processo
 *   que morre no meio não deixa item "feito pela metade".
 * - Antes de cada item: renova o lease (`renewLease`) e confere o "Parar" (`stop_requested`).
 *   Lease perdido (a proposta não está mais `executing`) encerra o laço sem tocar em nada.
 * - O item é travado (`FOR UPDATE`) e só roda se ainda estiver `pending`: dois executores
 *   concorrentes (o original lento e a varredura que o retomou) nunca executam o mesmo item.
 * - Estado final: todos `done` → `completed`; algum `done` → `partially_completed`; nenhum
 *   `done` → `failed` (ou `cancelled`, se parou antes do primeiro). `undo_deadline` por origem
 *   e nível (§4).
 * - Progresso em `copilot:proposal_updated` com throttle (`progress.ts`).
 *
 * O nível 2 executa na hora, DENTRO da transação do callback da ferramenta (a proposta acabou
 * de ser gravada e ainda não foi confirmada no banco): `run` usa savepoints dessa transação.
 */
import { and, eq } from 'drizzle-orm';
import {
  copilotProposalsRepo,
  schema,
  withWorkspace,
  type CopilotActionItemPatch,
  type CopilotActionItemRow,
  type CopilotProposalRow,
  type DbTx,
} from '@hm/db';
import { CAPABILITIES, CapabilityKeySchema } from '@hm/shared';
import type {
  CapabilityExecutor,
  ExecuteItemResult,
  ExecutorContext,
} from '../../../internal/copilot/core/executor-types';
import { resolveCopilotPrincipal, type CopilotPrincipal } from '../identity/principal';
import { recordProposalAudit } from './audit';
import { auditCounts, countItems, toExecutableItem } from './items';
import { ProgressThrottle, proposalAudience, proposalPayload } from './progress';
import { UNDO_WINDOW_SECONDS, type ProposalEngineDeps } from './types';

/** Roda `fn` numa transação RLS (por item). */
export type TxRunner = <T>(fn: (tx: DbTx) => Promise<T>) => Promise<T>;

export function workspaceRunner(workspaceId: string): TxRunner {
  return (fn) => withWorkspace(workspaceId, fn);
}

/** Savepoints de uma transação já aberta (execução na hora, nível 2). */
export function savepointRunner(tx: DbTx): TxRunner {
  return (fn) => tx.transaction(fn);
}

const ERROR_CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;

/** Código estável de um erro de domínio (`TransitionError.code`…). Nunca a mensagem. */
export function errorCodeOf(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code: unknown = (err as { code: unknown }).code;
    if (typeof code === 'string' && ERROR_CODE_RE.test(code)) return code;
  }
  return 'execution_error';
}

function cleanCode(code: string | undefined, fallback: string): string {
  return code !== undefined && ERROR_CODE_RE.test(code) ? code : fallback;
}

/** A proposta, depois de executada, pode ser desfeita? (catálogo + executor + nível) */
export function undoAllowed(
  executor: CapabilityExecutor | undefined,
  row: Pick<CopilotProposalRow, 'capability' | 'riskLevel'>,
  args: unknown,
): boolean {
  if (!executor?.undoItem) return false;
  const cap = CapabilityKeySchema.safeParse(row.capability);
  if (!cap.success) return false;
  if (row.riskLevel >= 4) return executor.allowsUndoAtLevel4?.(args) === true;
  return CAPABILITIES[cap.data].undoable;
}

function itemPatch(
  locked: CopilotActionItemRow,
  result: ExecuteItemResult,
  now: Date,
): CopilotActionItemPatch {
  const after = locked.after ?? {};
  switch (result.status) {
    case 'done':
      return {
        executedAt: now,
        after: { ...after, state: result.after ?? after['planned'] ?? null },
        undoPayload: result.undoPayload ?? null,
        errorCode: null,
      };
    case 'skipped_conflict':
      return {
        after: { ...after, conflict_by: result.conflictBy?.slice(0, 120) ?? null },
        errorCode: cleanCode(result.errorCode, 'conflict'),
      };
    case 'skipped_policy':
      return { errorCode: cleanCode(result.errorCode, 'policy') };
    case 'failed':
      return { errorCode: cleanCode(result.errorCode, 'execution_error') };
  }
}

type StepOutcome =
  | { readonly kind: 'item'; readonly row: CopilotActionItemRow }
  | { readonly kind: 'skip' }
  | { readonly kind: 'stop' }
  | { readonly kind: 'lost' };

/** Fecha a proposta `executing` no estado final (CAS; tenta de novo se o "Parar" mexeu na versão). */
async function finalize(
  deps: ProposalEngineDeps,
  run: TxRunner,
  proposalId: string,
  executor: CapabilityExecutor | undefined,
  args: unknown,
  flags: { readonly stopped: boolean; readonly abortCode: string | null },
): Promise<{ row: CopilotProposalRow; items: CopilotActionItemRow[] } | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const outcome = await run(async (tx) => {
      const cur = await copilotProposalsRepo.getWithItems(tx, proposalId);
      if (!cur) return { done: true as const, value: null };
      if (cur.proposal.status !== 'executing') {
        return { done: true as const, value: { row: cur.proposal, items: cur.items } };
      }
      const now = deps.now();
      const counts = countItems(cur.items);
      const to =
        counts.total > 0 && counts.done === counts.total
          ? 'completed'
          : counts.done > 0
            ? 'partially_completed'
            : flags.stopped
              ? 'cancelled'
              : 'failed';
      const undoable =
        (to === 'completed' || to === 'partially_completed') &&
        undoAllowed(executor, cur.proposal, args);
      const window =
        cur.proposal.source === 'autopilot'
          ? UNDO_WINDOW_SECONDS.autopilot
          : UNDO_WINDOW_SECONDS.copilot;
      const row = await copilotProposalsRepo.transition(tx, {
        id: proposalId,
        from: ['executing'],
        to,
        expectedVersion: cur.proposal.version,
        patch: {
          completedAt: now,
          leaseExpiresAt: null,
          undoDeadline: undoable ? new Date(now.getTime() + window * 1000) : null,
        },
      });
      if (!row) return { done: false as const };
      await recordProposalAudit(tx, {
        proposal: row,
        event: to,
        from: 'executing',
        actorMemberId: row.executedAsMemberId,
        counts: auditCounts(counts),
        extra: {
          ...(flags.stopped ? { stopped: true } : {}),
          ...(flags.abortCode ? { abort: flags.abortCode } : {}),
        },
      });
      return { done: true as const, value: { row, items: cur.items } };
    });
    if (outcome.done) return outcome.value;
  }
  deps.logger.error('copilot-proposals: não foi possível fechar a proposta', { proposalId });
  return null;
}

/** Falha todos os itens pendentes com o mesmo motivo (executor ausente, ator inativo…). */
async function failPending(run: TxRunner, proposalId: string, code: string): Promise<void> {
  await run(async (tx) => {
    await tx
      .update(schema.copilotActionItems)
      .set({ status: 'failed', errorCode: code })
      .where(
        and(
          eq(schema.copilotActionItems.proposalId, proposalId),
          eq(schema.copilotActionItems.status, 'pending'),
        ),
      );
  });
}

export interface RunExecutionInput {
  readonly workspaceId: string;
  readonly proposalId: string;
  /** Default: uma transação `withWorkspace` por item. */
  readonly run?: TxRunner;
}

/**
 * Executa (ou retoma) uma proposta `executing`: só os itens `pending`. Devolve a linha final
 * (ou `null` se a proposta sumiu / o lease foi perdido para outro executor).
 */
export async function runProposalExecution(
  deps: ProposalEngineDeps,
  input: RunExecutionInput,
): Promise<CopilotProposalRow | null> {
  const run = input.run ?? workspaceRunner(input.workspaceId);
  const loaded = await run((tx) => copilotProposalsRepo.getWithItems(tx, input.proposalId));
  if (!loaded || loaded.proposal.status !== 'executing') return loaded?.proposal ?? null;
  const proposal = loaded.proposal;

  const executor = deps.executors.get(proposal.capability);
  let abortCode: string | null = null;
  let args: unknown = null;
  let principal: CopilotPrincipal | null = null;
  if (!executor) {
    abortCode = 'executor_unavailable';
  } else {
    const parsed = executor.argsSchema.safeParse(proposal.args);
    if (!parsed.success) abortCode = 'invalid_args';
    else args = parsed.data;
  }
  if (!abortCode) {
    const actorId = proposal.executedAsMemberId ?? proposal.requestedByMemberId;
    principal = actorId
      ? await run((tx) =>
          resolveCopilotPrincipal(tx, {
            workspaceId: input.workspaceId,
            memberId: actorId,
            now: deps.now(),
          }),
        )
      : null;
    if (!principal || principal.memberStatus !== 'active') abortCode = 'actor_inactive';
  }

  if (abortCode || !executor || !principal) {
    deps.logger.warn('copilot-proposals: execução abortada', {
      proposalId: proposal.id,
      code: abortCode,
    });
    await failPending(run, proposal.id, abortCode ?? 'execution_error');
    const closed = await finalize(deps, run, proposal.id, executor, args, {
      stopped: false,
      abortCode,
    });
    if (closed) await flushFinal(deps, closed.row, closed.items);
    return closed?.row ?? null;
  }

  // Constantes para os closures (o estreitamento de `let` não atravessa funções).
  const actor: CopilotPrincipal = principal;
  const exec: CapabilityExecutor = executor;
  const throttle = new ProgressThrottle(deps, input.workspaceId, proposalAudience(proposal));
  const items = [...loaded.items];
  const pending = items.filter((i) => i.status === 'pending');
  let stopped = false;

  for (const item of pending) {
    const step: StepOutcome = await run(async (tx): Promise<StepOutcome> => {
      const lease = await copilotProposalsRepo.renewLease(tx, proposal.id);
      if (!lease) return { kind: 'lost' };
      if (lease.stopRequested) return { kind: 'stop' };
      const [locked] = await tx
        .select()
        .from(schema.copilotActionItems)
        .where(
          and(
            eq(schema.copilotActionItems.id, item.id),
            eq(schema.copilotActionItems.status, 'pending'),
          ),
        )
        .for('update');
      if (!locked) return { kind: 'skip' };
      const now = deps.now();
      let result: ExecuteItemResult;
      try {
        result = await tx.transaction((sp) => {
          const ctx: ExecutorContext = {
            tx: sp,
            principal: actor,
            requestedByMemberId: proposal.requestedByMemberId ?? actor.memberId,
            proposalId: proposal.id,
            source: proposal.source,
            now,
          };
          return exec.executeItem(ctx, args, toExecutableItem(locked));
        });
      } catch (err) {
        deps.logger.warn('copilot-proposals: item falhou', {
          proposalId: proposal.id,
          itemId: locked.id,
          code: errorCodeOf(err),
          errorName: err instanceof Error ? err.name : typeof err,
        });
        result = { status: 'failed', errorCode: errorCodeOf(err) };
      }
      const row = await copilotProposalsRepo.setItemStatus(tx, {
        itemId: locked.id,
        from: ['pending'],
        to: result.status,
        patch: itemPatch(locked, result, now),
      });
      return row ? { kind: 'item', row } : { kind: 'skip' };
    });

    if (step.kind === 'lost') return null;
    if (step.kind === 'stop') {
      stopped = true;
      break;
    }
    if (step.kind === 'item') {
      const idx = items.findIndex((i) => i.id === step.row.id);
      if (idx >= 0) items[idx] = step.row;
      throttle.push(proposalPayload(proposal, items));
    }
  }

  const closed = await finalize(deps, run, proposal.id, executor, args, {
    stopped,
    abortCode: null,
  });
  if (closed) await throttle.flush(proposalPayload(closed.row, closed.items));
  return closed?.row ?? null;
}

async function flushFinal(
  deps: ProposalEngineDeps,
  row: CopilotProposalRow,
  items: readonly CopilotActionItemRow[],
): Promise<void> {
  const throttle = new ProgressThrottle(deps, row.workspaceId, proposalAudience(row));
  await throttle.flush(proposalPayload(row, items));
}

// ─── Execuções em segundo plano (confirmar → 202; varredura) ─────────────────────

const inflight = new Set<Promise<unknown>>();

/**
 * Dispara a execução fora do request (o confirmar responde 202). Rastreada para o shutdown
 * esperar (`drainProposalExecutions`). Nunca rejeita: falha vira log, e a varredura retoma
 * pelo lease.
 */
export function startProposalExecution(
  deps: ProposalEngineDeps,
  input: RunExecutionInput,
): Promise<CopilotProposalRow | null> {
  const promise = runProposalExecution(deps, input).catch((err: unknown) => {
    deps.logger.error('copilot-proposals: execução interrompida (a varredura retoma)', {
      ref: 'hm_copilot_proposal_execution',
      proposalId: input.proposalId,
      errorName: err instanceof Error ? err.name : typeof err,
    });
    return null;
  });
  inflight.add(promise);
  void promise.finally(() => inflight.delete(promise));
  return promise;
}

/** Espera as execuções em andamento (shutdown e testes). */
export async function drainProposalExecutions(): Promise<void> {
  while (inflight.size > 0) await Promise.allSettled([...inflight]);
}
