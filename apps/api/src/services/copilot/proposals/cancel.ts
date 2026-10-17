/**
 * Cancelar e Parar (ADR-004 §3; spec §5.2).
 *
 * - Antes de executar (`proposed`, `blocked`, `awaiting_approval`) → `cancelled`. Se quem cancela
 *   é o aprovador, é uma RECUSA: o solicitante é avisado (`copilot_aprovacao`).
 * - Executando → `stop_requested = true`. O laço confere entre itens e fecha
 *   `partially_completed` ("o que já foi movido fica onde está").
 * - Dono ou aprovador. Repetir é inofensivo (devolve o estado atual).
 */
import {
  copilotProposalsRepo,
  type CopilotActionItemRow,
  type CopilotProposalRow,
  type CopilotProposalStatus,
  type DbTx,
} from '@hm/db';
import type { ProposalDTO } from '@hm/shared';
import type { NotifiableEvent } from '../../notifications';
import type { CopilotPrincipal } from '../identity/principal';
import { approvalNotification } from './approval';
import { recordProposalAudit } from './audit';
import { buildProposalDTO, canViewProposal } from './dto';
import { auditCounts, countItems } from './items';
import { fail, type ProposalEngineDeps, type ProposalFailure } from './types';

const CANCELLABLE: readonly CopilotProposalStatus[] = ['proposed', 'blocked', 'awaiting_approval'];

export interface Cancelled {
  readonly ok: true;
  readonly proposal: ProposalDTO;
  readonly row: CopilotProposalRow;
  readonly items: CopilotActionItemRow[];
  readonly notification: NotifiableEvent | null;
}

export async function cancelProposal(
  deps: ProposalEngineDeps,
  tx: DbTx,
  viewer: CopilotPrincipal,
  proposalId: string,
): Promise<Cancelled | ProposalFailure> {
  const now = deps.now();
  // Até 3 tentativas: o CAS pode colidir com outra transição concorrente (ex.: o fechamento).
  for (let attempt = 0; attempt < 3; attempt++) {
    const loaded = await copilotProposalsRepo.getWithItems(tx, proposalId);
    if (!loaded || !canViewProposal(loaded.proposal, viewer)) return fail('not_found');
    const { proposal, items } = loaded;
    const isOwner = proposal.requestedByMemberId === viewer.memberId;
    const isApprover = proposal.approverMemberId === viewer.memberId;
    if (!isOwner && !isApprover) return fail('forbidden');

    const ok = async (
      row: CopilotProposalRow,
      notification: NotifiableEvent | null,
    ): Promise<Cancelled> => ({
      ok: true,
      proposal: await buildProposalDTO(tx, row, items, viewer, now),
      row,
      items,
      notification,
    });

    if (proposal.status === 'cancelled') return ok(proposal, null);
    if (proposal.status === 'executing' && proposal.stopRequested) return ok(proposal, null);

    if (CANCELLABLE.includes(proposal.status)) {
      const row = await copilotProposalsRepo.transition(tx, {
        id: proposal.id,
        from: [proposal.status],
        to: 'cancelled',
        expectedVersion: proposal.version,
      });
      if (!row) continue;
      const rejected = proposal.status === 'awaiting_approval' && isApprover && !isOwner;
      await recordProposalAudit(tx, {
        proposal: row,
        event: 'cancelled',
        from: proposal.status,
        actorMemberId: viewer.memberId,
        counts: auditCounts(countItems(items)),
        ...(rejected ? { extra: { rejected: true } } : {}),
      });
      return ok(row, rejected ? approvalNotification(row, 'rejected') : null);
    }

    if (proposal.status === 'executing') {
      const row = await copilotProposalsRepo.transition(tx, {
        id: proposal.id,
        from: ['executing'],
        to: 'executing',
        expectedVersion: proposal.version,
        patch: { stopRequested: true },
      });
      if (!row) continue;
      await recordProposalAudit(tx, {
        proposal: row,
        event: 'stop_requested',
        from: 'executing',
        actorMemberId: viewer.memberId,
        counts: auditCounts(countItems(items)),
      });
      return ok(row, null);
    }

    return fail('not_cancellable');
  }
  return fail('stale_proposal');
}
