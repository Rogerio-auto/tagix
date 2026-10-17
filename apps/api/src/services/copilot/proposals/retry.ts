/**
 * Tentar de novo (ADR-004 §3): cria OUTRA proposta, só com os itens `failed`/`skipped_conflict`
 * (e os que o "Parar" deixou de fora, `skipped_policy`/`stopped`) da original, com resolução e
 * versão novas (re-resolve sob o escopo de agora: o que sumiu do escopo fica de fora e é
 * informado). A trilha fica limpa: uma proposta, uma intenção.
 *
 * Idempotente por `Idempotency-Key`, no mesmo esquema do confirmar: a mesma chave devolve a
 * proposta já criada (200); outra chave, com uma nova já criada, é 409 `already_retried`. A
 * linha da original fica travada (`FOR UPDATE`) durante a decisão: dois cliques paralelos não
 * criam duas propostas. A chave vive na trilha (`copilot.proposal.retried`).
 *
 * A nova proposta nasce `proposed` (ou `blocked`), nunca executada direto: foi o modelo que
 * escreveu os `args` originais, e quem clica "Tentar de novo" confirma a prévia NOVA, com os
 * estados de agora. O nível de risco é recalculado; a contaminação do turno original continua
 * valendo.
 */
import { eq } from 'drizzle-orm';
import { copilotProposalsRepo, schema, type CopilotActionItemRow, type DbTx } from '@hm/db';
import type { ProposalDTO } from '@hm/shared';
import type { CopilotPrincipal } from '../identity/principal';
import { findRetry, recordProposalAudit } from './audit';
import { executorContext } from './context';
import { buildProposalDTO, canViewProposal } from './dto';
import { STOPPED_ITEM_CODE } from './execute';
import { auditCounts, countItems } from './items';
import { createProposal, readTurnTainted } from './propose';
import { fail, type ProposalEngineDeps, type ProposalFailure } from './types';

export interface Retried {
  readonly ok: true;
  /** 201 = criada agora; 200 = replay com a mesma chave. */
  readonly status: 200 | 201;
  readonly proposal: ProposalDTO;
}

/** Item que entra no "Tentar de novo". */
export function isRetryable(item: CopilotActionItemRow): boolean {
  return (
    item.status === 'failed' ||
    item.status === 'skipped_conflict' ||
    (item.status === 'skipped_policy' && item.errorCode === STOPPED_ITEM_CODE)
  );
}

const RETRYABLE_PROPOSAL_STATUSES = new Set(['partially_completed', 'failed', 'cancelled']);

function unreachableAfterCommit(): never {
  throw new Error('copilot: "tentar de novo" nunca executa (a proposta nasce proposed).');
}

export async function retryFailedItems(
  deps: ProposalEngineDeps,
  tx: DbTx,
  viewer: CopilotPrincipal,
  proposalId: string,
  idempotencyKey: string,
): Promise<Retried | ProposalFailure> {
  const now = deps.now();
  // Serializa cliques paralelos na mesma original.
  const [lockedRow] = await tx
    .select({ id: schema.copilotActionProposals.id })
    .from(schema.copilotActionProposals)
    .where(eq(schema.copilotActionProposals.id, proposalId))
    .for('update');
  if (!lockedRow) return fail('not_found');
  const loaded = await copilotProposalsRepo.getWithItems(tx, proposalId);
  if (!loaded || !canViewProposal(loaded.proposal, viewer)) return fail('not_found');
  const { proposal, items } = loaded;
  if (proposal.requestedByMemberId !== viewer.memberId) return fail('forbidden');

  const previous = await findRetry(tx, proposal.id);
  if (previous) {
    if (previous.key !== idempotencyKey || !previous.retryProposalId) {
      return fail('already_retried');
    }
    const created = await copilotProposalsRepo.getWithItems(tx, previous.retryProposalId);
    if (!created) return fail('not_found');
    return {
      ok: true,
      status: 200,
      proposal: await buildProposalDTO(tx, created.proposal, created.items, viewer, now),
    };
  }

  if (!RETRYABLE_PROPOSAL_STATUSES.has(proposal.status)) return fail('nothing_to_retry');
  const retryable = new Set(items.filter(isRetryable).map((i) => `${i.targetType}:${i.targetId}`));
  if (retryable.size === 0) return fail('nothing_to_retry');

  const executor = deps.executors.get(proposal.capability);
  if (!executor) return fail('executor_unavailable');
  const args = executor.argsSchema.safeParse(proposal.args);
  if (!args.success) return fail('nothing_to_retry');

  const resolved = await executor.resolveTargets(
    executorContext({
      tx,
      principal: viewer,
      requestedByMemberId: viewer.memberId,
      proposalId: null,
      source: proposal.source,
      now,
    }),
    args.data,
  );
  const targets = resolved.targets.filter((t) => retryable.has(`${t.type}:${t.id}`));
  const found = new Set(targets.map((t) => `${t.type}:${t.id}`));
  const dropped = [...retryable]
    .filter((k) => !found.has(k))
    .map((k) => ({ id: k.slice(k.indexOf(':') + 1), reason: 'not_found' as const }));

  const outcome = await createProposal(
    deps,
    {
      tx,
      principal: viewer,
      source: proposal.source,
      turnId: proposal.turnId,
      sessionId: proposal.sessionId,
      turnTainted: await readTurnTainted(tx, proposal.turnId),
      afterCommit: unreachableAfterCommit,
    },
    executor,
    args.data,
    { targets, dropped },
    { forceProposed: true },
  );
  if (outcome.kind === 'invalid_args' || outcome.kind === 'batch_too_large') {
    return fail('nothing_to_retry');
  }
  await recordProposalAudit(tx, {
    proposal,
    event: 'retried',
    from: proposal.status,
    actorMemberId: viewer.memberId,
    counts: auditCounts(countItems(items)),
    extra: { retry_key: idempotencyKey, retry_proposal_id: outcome.row.id },
  });
  return { ok: true, status: 201, proposal: outcome.proposal };
}
