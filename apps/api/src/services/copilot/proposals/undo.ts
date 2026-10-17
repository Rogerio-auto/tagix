/**
 * Desfazer (ADR-004 §4): idempotente por chave, item a item em ordem INVERSA, conferindo o
 * estado atual contra o `after` gravado (o executor faz a conferência no `undoItem`).
 *
 * Fluxo:
 *   1. numa transação: visível (404) → dono ou `copilot.activity.view_all` (403) → estado
 *      desfazível (409 `not_undoable`) → janela (410 `undo_window_closed`) → permissão ATUAL da
 *      capacidade de QUEM DESFAZ (402/403) → reivindicação por CAS (`undone_at`, `undone_by`,
 *      `version+1`) + trilha `undo_started` com a chave;
 *   2. cada item `done` na sua transação (`FOR UPDATE`, só se ainda `done`): `undoItem` →
 *      `undone` ou `undo_conflict`;
 *   3. fecha `undone` (todos voltaram) ou `partially_undone`.
 *
 * Mesma chave: devolve o estado atual, ou RETOMA um desfazer interrompido no meio (os itens já
 * desfeitos não são tocados de novo). Outra chave numa proposta já desfeita: 409 `not_undoable`.
 * Outra chave num desfazer em andamento: 409, SALVO se ele está parado há mais de
 * `UNDO_STALL_TAKEOVER_MS` (o processo que o começou morreu e a chave original se perdeu no
 * cliente): aí a chave nova assume e retoma, com trilha `undo_started { resumed: true }`.
 * Enquanto não há coluna própria (`undo_idempotency_key`), a chave vive na trilha.
 *
 * O orçamento do Copiloto NÃO barra o desfazer: desfazer não chama o modelo, e travar a correção
 * de um erro por causa da fatura seria o pior momento para dizer não.
 */
import { and, eq } from 'drizzle-orm';
import {
  copilotProposalsRepo,
  schema,
  withWorkspace,
  type CopilotActionItemRow,
  type CopilotProposalRow,
  type DbTx,
} from '@hm/db';
import { can, type ProposalDTO } from '@hm/shared';
import type { UndoItemResult } from '../../../internal/copilot/core/executor-types';
import { resolveCopilotPrincipal, type CopilotPrincipal } from '../identity/principal';
import { findUndoKey, recordProposalAudit } from './audit';
import { AfterCommitQueue, authorizeWrite, executorContext } from './context';
import { buildProposalDTO, canViewProposal, capabilityOf } from './dto';
import { errorCodeOf, undoAllowed, type TxRunner } from './execute';
import { auditCounts, countItems, toUndoableItem } from './items';
import { publishProposalState } from './progress';
import { UNDOABLE_STATUSES, fail, type ProposalEngineDeps, type ProposalFailure } from './types';

/** Desfazer começado e sem progresso há mais que isto aceita outra `Idempotency-Key`. */
export const UNDO_STALL_TAKEOVER_MS = 10 * 60_000;

/** Último sinal de vida do desfazer: o começo ou o último item desfeito. */
function lastUndoProgress(
  proposal: CopilotProposalRow,
  items: readonly CopilotActionItemRow[],
): number {
  let last = proposal.undoneAt?.getTime() ?? 0;
  for (const item of items) {
    const at = item.undoneAt?.getTime() ?? 0;
    if (at > last) last = at;
  }
  return last;
}

export interface Undone {
  readonly ok: true;
  readonly proposal: ProposalDTO;
  readonly row: CopilotProposalRow;
  readonly items: CopilotActionItemRow[];
}

type Claim =
  | {
      readonly kind: 'replay';
      readonly row: CopilotProposalRow;
      readonly items: CopilotActionItemRow[];
    }
  | { readonly kind: 'run'; readonly row: CopilotProposalRow; readonly principal: CopilotPrincipal }
  | ProposalFailure;

async function claimUndo(
  deps: ProposalEngineDeps,
  tx: DbTx,
  viewer: CopilotPrincipal,
  proposalId: string,
  key: string,
): Promise<Claim> {
  const now = deps.now();
  const loaded = await copilotProposalsRepo.getWithItems(tx, proposalId);
  if (!loaded || !canViewProposal(loaded.proposal, viewer)) return fail('not_found');
  const { proposal, items } = loaded;
  const isOwner = proposal.requestedByMemberId === viewer.memberId;
  if (!isOwner && !can(viewer.role, 'copilot.activity.view_all')) return fail('forbidden');

  if (proposal.status === 'undone' || proposal.status === 'partially_undone') {
    return (await findUndoKey(tx, proposal.id)) === key
      ? { kind: 'replay', row: proposal, items }
      : fail('not_undoable');
  }
  if (!UNDOABLE_STATUSES.includes(proposal.status)) return fail('not_undoable');

  const executor = deps.executors.get(proposal.capability);
  const args = executor?.argsSchema.safeParse(proposal.args);
  if (!executor || !args?.success || !undoAllowed(executor, proposal, args.data)) {
    return fail('not_undoable');
  }
  if (!proposal.undoDeadline) return fail('not_undoable');

  // Desfazer já começou: a mesma chave continua; outra só assume um desfazer parado.
  let takeover = false;
  if (proposal.undoneAt) {
    if ((await findUndoKey(tx, proposal.id)) !== key) {
      if (now.getTime() - lastUndoProgress(proposal, items) < UNDO_STALL_TAKEOVER_MS) {
        return fail('not_undoable');
      }
      takeover = true;
    }
  } else if (proposal.undoDeadline.getTime() <= now.getTime()) {
    return fail('undo_window_closed');
  }

  const principal = await resolveCopilotPrincipal(tx, {
    workspaceId: viewer.workspaceId,
    memberId: viewer.memberId,
    now,
  });
  if (!principal) return fail('forbidden');
  const counts = countItems(items);
  const auth = authorizeWrite(principal, executor, capabilityOf(proposal), {
    budget: 'ok',
    targetCount: Math.max(1, counts.done),
  });
  if (!auth.allowed) {
    if (auth.reason === 'subscription_inactive') return fail('subscription_inactive');
    if (auth.reason === 'capability_disabled' || auth.reason === 'copilot_disabled') {
      return fail('capability_disabled');
    }
    return fail('forbidden');
  }

  if (proposal.undoneAt && !takeover) return { kind: 'run', row: proposal, principal };

  const row = await copilotProposalsRepo.transition(tx, {
    id: proposal.id,
    from: [proposal.status],
    to: proposal.status,
    expectedVersion: proposal.version,
    patch: { undoneAt: now, undoneBy: principal.memberId },
  });
  if (!row) {
    // Perdeu a corrida para outro desfazer (já commitado): mesma chave continua, outra não.
    return (await findUndoKey(tx, proposal.id)) === key
      ? claimUndo(deps, tx, viewer, proposalId, key)
      : fail('not_undoable');
  }
  await recordProposalAudit(tx, {
    proposal: row,
    event: 'undo_started',
    from: proposal.status,
    actorMemberId: principal.memberId,
    counts: auditCounts(counts),
    extra: { undo_key: key, ...(takeover ? { resumed: true } : {}) },
  });
  return { kind: 'run', row, principal };
}

export async function undoProposal(
  deps: ProposalEngineDeps,
  viewer: CopilotPrincipal,
  proposalId: string,
  key: string,
  run: TxRunner = (fn) => withWorkspace(viewer.workspaceId, fn),
): Promise<Undone | ProposalFailure> {
  const claim = await run((tx) => claimUndo(deps, tx, viewer, proposalId, key));
  if ('ok' in claim) return claim;
  if (claim.kind === 'replay') {
    const dto = await run((tx) => buildProposalDTO(tx, claim.row, claim.items, viewer, deps.now()));
    return { ok: true, proposal: dto, row: claim.row, items: claim.items };
  }

  const { row: proposal, principal } = claim;
  const executor = deps.executors.get(proposal.capability);
  const undoItem = executor?.undoItem?.bind(executor);
  if (!undoItem) return fail('not_undoable');

  const done = await run(async (tx) =>
    (await copilotProposalsRepo.listItems(tx, proposal.id))
      .filter((i) => i.status === 'done')
      .sort((a, b) => b.position - a.position),
  );

  for (const item of done) {
    const itemQueue = new AfterCommitQueue();
    await run(async (tx) => {
      const [locked] = await tx
        .select()
        .from(schema.copilotActionItems)
        .where(
          and(
            eq(schema.copilotActionItems.id, item.id),
            eq(schema.copilotActionItems.status, 'done'),
          ),
        )
        .for('update');
      if (!locked) return;
      const now = deps.now();
      let result: UndoItemResult;
      try {
        result = await tx.transaction((sp) =>
          undoItem(
            executorContext({
              tx: sp,
              principal,
              requestedByMemberId: proposal.requestedByMemberId ?? principal.memberId,
              proposalId: proposal.id,
              source: proposal.source,
              now,
              afterCommit: (fn) => itemQueue.push(fn),
            }),
            toUndoableItem(locked),
          ),
        );
      } catch (err) {
        itemQueue.clear();
        deps.logger.warn('copilot-proposals: desfazer item falhou', {
          proposalId: proposal.id,
          itemId: locked.id,
          code: errorCodeOf(err),
        });
        result = { status: 'failed', errorCode: 'undo_failed' };
      }
      await copilotProposalsRepo.setItemStatus(tx, {
        itemId: locked.id,
        from: ['done'],
        to: result.status === 'undone' ? 'undone' : 'undo_conflict',
        patch:
          result.status === 'undone'
            ? { undoneAt: now }
            : { errorCode: result.status === 'failed' ? 'undo_failed' : 'undo_conflict' },
      });
    });
    // Transação do item confirmada: agora os efeitos externos do executor podem sair.
    await itemQueue.drain(deps.logger);
  }

  const closed = await run(async (tx) => {
    const cur = await copilotProposalsRepo.getWithItems(tx, proposal.id);
    if (!cur) return null;
    if (!UNDOABLE_STATUSES.includes(cur.proposal.status)) return cur;
    const counts = countItems(cur.items);
    const to = counts.undoConflict === 0 && counts.done === 0 ? 'undone' : 'partially_undone';
    const row = await copilotProposalsRepo.transition(tx, {
      id: proposal.id,
      from: [cur.proposal.status],
      to,
      expectedVersion: cur.proposal.version,
    });
    if (!row) return copilotProposalsRepo.getWithItems(tx, proposal.id);
    await recordProposalAudit(tx, {
      proposal: row,
      event: to,
      from: cur.proposal.status,
      actorMemberId: principal.memberId,
      counts: auditCounts(counts),
    });
    return { proposal: row, items: cur.items };
  });
  if (!closed) return fail('not_found');
  await publishProposalState(deps, closed.proposal, closed.items);
  const dto = await run((tx) =>
    buildProposalDTO(tx, closed.proposal, closed.items, viewer, deps.now()),
  );
  return { ok: true, proposal: dto, row: closed.proposal, items: closed.items };
}
