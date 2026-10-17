/**
 * Tentar de novo (ADR-004 §3): cria OUTRA proposta, só com os itens `failed`/`skipped_conflict`
 * da original, com resolução e versão novas (re-resolve sob o escopo de agora: o que sumiu do
 * escopo fica de fora e é informado). A trilha fica limpa: uma proposta, uma intenção.
 *
 * A nova proposta nasce `proposed` (ou `blocked`), nunca executada direto: foi o modelo que
 * escreveu os `args` originais, e quem clica "Tentar de novo" confirma a prévia NOVA, com os
 * estados de agora. O nível de risco é recalculado; a contaminação do turno original continua
 * valendo.
 */
import { copilotProposalsRepo, type DbTx } from '@hm/db';
import type { ProposalDTO } from '@hm/shared';
import type { CopilotPrincipal } from '../identity/principal';
import { canViewProposal } from './dto';
import { createProposal, readTurnTainted } from './propose';
import { fail, type ProposalEngineDeps, type ProposalFailure } from './types';

export interface Retried {
  readonly ok: true;
  readonly proposal: ProposalDTO;
}

export async function retryFailedItems(
  deps: ProposalEngineDeps,
  tx: DbTx,
  viewer: CopilotPrincipal,
  proposalId: string,
): Promise<Retried | ProposalFailure> {
  const loaded = await copilotProposalsRepo.getWithItems(tx, proposalId);
  if (!loaded || !canViewProposal(loaded.proposal, viewer)) return fail('not_found');
  const { proposal, items } = loaded;
  if (proposal.requestedByMemberId !== viewer.memberId) return fail('forbidden');
  if (proposal.status !== 'partially_completed' && proposal.status !== 'failed') {
    return fail('nothing_to_retry');
  }
  const retryable = new Set(
    items
      .filter((i) => i.status === 'failed' || i.status === 'skipped_conflict')
      .map((i) => `${i.targetType}:${i.targetId}`),
  );
  if (retryable.size === 0) return fail('nothing_to_retry');

  const executor = deps.executors.get(proposal.capability);
  if (!executor) return fail('executor_unavailable');
  const args = executor.argsSchema.safeParse(proposal.args);
  if (!args.success) return fail('nothing_to_retry');

  const resolved = await executor.resolveTargets(
    {
      tx,
      principal: viewer,
      requestedByMemberId: viewer.memberId,
      proposalId: null,
      source: proposal.source,
      now: deps.now(),
    },
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
    },
    executor,
    args.data,
    { targets, dropped },
    { forceProposed: true },
  );
  switch (outcome.kind) {
    case 'invalid_args':
    case 'batch_too_large':
      return fail('nothing_to_retry');
    default:
      return { ok: true, proposal: outcome.proposal };
  }
}
