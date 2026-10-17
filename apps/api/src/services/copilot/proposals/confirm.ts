/**
 * Confirmar (ADR-004 §2): idempotente, revalidado e otimista.
 *
 * Revalida TUDO no instante do clique, nesta ordem:
 *   visível (senão 404) → dono em `proposed` ou aprovador em `awaiting_approval` (senão 403) →
 *   replay pela chave (mesma chave = estado atual, 200; outra = 409 `already_confirmed`) →
 *   status confirmável → prazo (410 `proposal_expired`) → versão (409 `stale_proposal`) →
 *   ajustes do corpo (recalculam e incrementam a versão) → "Revisei" no nível 4 (422) →
 *   permissão ATUAL de quem confirma recarregada do banco (papel, matriz, `requires`,
 *   assinatura, orçamento: 403/402) → alvos re-resolvidos sob o principal de QUEM CONFIRMA (o
 *   aprovador só executa o que ele enxerga; o resto vira `excluded`/`not_found`) →
 *   política do nível 4 recalculada (409 `policy_blocked`) →
 *   CAS `proposed|awaiting_approval → executing` com a chave, `version+1` e lease de 2 min, e
 *   as exclusões do escopo gravadas na MESMA transação.
 *
 * Ajuste + confirmar é atômico: com `adjustments`, tudo roda num savepoint, e qualquer desfecho
 * que não seja "aceito agora" (402/403/409/410/422, replay) desfaz o ajuste. A proposta nunca
 * fica alterada por um confirmar que não confirmou.
 *
 * Duas confirmações paralelas: as duas leem a versão `v`; o UPDATE da segunda espera o lock da
 * linha (a primeira ainda não commitou) e, quando reavalia, não casa mais (status/versão
 * mudaram). Ela relê e responde como replay (mesma chave) ou 409 (outra chave). Uma execução.
 *
 * O confirmar NÃO executa: devolve `start`, que o chamador dispara DEPOIS do commit (a rota
 * responde 202). Se o processo cair antes, a varredura retoma pelo lease.
 */
import {
  COPILOT_PROPOSAL_LEASE_SECONDS,
  copilotProposalsRepo,
  type CopilotActionItemRow,
  type CopilotProposalRow,
  type DbTx,
} from '@hm/db';
import { PolicyCheckSchema, type ConfirmProposalInput, type ProposalDTO } from '@hm/shared';
import type { Target } from '../../../internal/copilot/core/executor-types';
import { loadCopilotBudget } from '../identity/budget';
import { resolveCopilotPrincipal, type CopilotPrincipal } from '../identity/principal';
import { applyAdjustment } from './adjust';
import { approvalNotification, pendingTargetRefs } from './approval';
import { recordProposalAudit } from './audit';
import { authorizeWrite, executorContext } from './context';
import { buildProposalDTO, canViewProposal, capabilityOf, hasPolicyBlock } from './dto';
import { startProposalExecution } from './execute';
import { auditCounts, countItems, itemBeforeState, itemLabel } from './items';
import type { NotifiableEvent } from '../../notifications';
import {
  POST_CONFIRM_STATUSES,
  fail,
  type ProposalEngineDeps,
  type ProposalFailure,
} from './types';

export interface ConfirmInput extends ConfirmProposalInput {
  /** Header `Idempotency-Key` (UUID). */
  readonly idempotencyKey: string;
}

export interface Confirmed {
  readonly ok: true;
  /** 202 = aceito agora (executando); 200 = replay com a mesma chave (estado atual). */
  readonly status: 200 | 202;
  readonly proposal: ProposalDTO;
  readonly row: CopilotProposalRow;
  readonly items: CopilotActionItemRow[];
  /** Dispara a execução. Chamar DEPOIS do commit. `null` no replay. */
  readonly start: (() => Promise<CopilotProposalRow | null>) | null;
  /** Aviso ao solicitante quando quem confirmou foi o aprovador. */
  readonly notification: NotifiableEvent | null;
}

type ConfirmOutcome = Confirmed | ProposalFailure;

/** Alvos (estado gravado) dos itens que vão executar, para recalcular a política. */
function targetsOf(items: readonly CopilotActionItemRow[]): Target[] {
  return items.map((i) => ({
    type: i.targetType,
    id: i.targetId,
    label: itemLabel(i),
    expectedVersion: i.expectedVersion,
    state: itemBeforeState(i) ?? {},
  }));
}

async function replayOrConflict(
  tx: DbTx,
  row: CopilotProposalRow,
  items: CopilotActionItemRow[],
  viewer: CopilotPrincipal,
  key: string,
  now: Date,
): Promise<ConfirmOutcome> {
  const dto = await buildProposalDTO(tx, row, items, viewer, now);
  if (row.confirmIdempotencyKey === key) {
    return { ok: true, status: 200, proposal: dto, row, items, start: null, notification: null };
  }
  return fail('already_confirmed', dto);
}

/** Sinal interno: desfaz o savepoint do ajuste + confirmar, levando o desfecho junto. */
class RollbackConfirm extends Error {
  constructor(readonly outcome: ConfirmOutcome) {
    super('rollback_confirm');
    this.name = 'RollbackConfirm';
  }
}

export async function confirmProposal(
  deps: ProposalEngineDeps,
  tx: DbTx,
  viewer: CopilotPrincipal,
  proposalId: string,
  input: ConfirmInput,
): Promise<ConfirmOutcome> {
  const hasAdjustments = input.adjustments && Object.keys(input.adjustments).length > 0;
  if (!hasAdjustments) return confirmInTx(deps, tx, viewer, proposalId, input);

  try {
    return await tx.transaction(async (sp) => {
      const out = await confirmInTx(deps, sp, viewer, proposalId, input);
      if (!out.ok || out.status !== 202) throw new RollbackConfirm(out);
      return out;
    });
  } catch (err) {
    if (!(err instanceof RollbackConfirm)) throw err;
    // O ajuste foi desfeito: o DTO devolvido precisa ser o do estado que FICOU.
    const out = err.outcome;
    if (!out.ok && !out.proposal) return out;
    const current = await copilotProposalsRepo.getWithItems(tx, proposalId);
    if (!current) return fail('not_found');
    const dto = await buildProposalDTO(tx, current.proposal, current.items, viewer, deps.now());
    if (!out.ok) return fail(out.error, dto);
    return { ...out, proposal: dto, row: current.proposal, items: current.items };
  }
}

async function confirmInTx(
  deps: ProposalEngineDeps,
  tx: DbTx,
  viewer: CopilotPrincipal,
  proposalId: string,
  input: ConfirmInput,
): Promise<ConfirmOutcome> {
  const now = deps.now();
  const loaded = await copilotProposalsRepo.getWithItems(tx, proposalId);
  if (!loaded || !canViewProposal(loaded.proposal, viewer)) return fail('not_found');
  let { proposal, items } = loaded;

  const isOwner = proposal.requestedByMemberId === viewer.memberId;
  const isApprover = proposal.approverMemberId === viewer.memberId;

  // Replay / já confirmada.
  if (POST_CONFIRM_STATUSES.includes(proposal.status)) {
    if (!isOwner && !isApprover) return fail('forbidden');
    return replayOrConflict(tx, proposal, items, viewer, input.idempotencyKey, now);
  }
  if (proposal.status === 'expired') return fail('proposal_expired');
  if (proposal.status !== 'proposed' && proposal.status !== 'awaiting_approval') {
    return fail('not_confirmable');
  }
  const asApprover = proposal.status === 'awaiting_approval';
  if (asApprover ? !isApprover : !isOwner) return fail('forbidden');

  if (!proposal.expiresAt || proposal.expiresAt.getTime() <= now.getTime()) {
    return fail('proposal_expired');
  }
  if (proposal.version !== input.version) {
    return fail('stale_proposal', await buildProposalDTO(tx, proposal, items, viewer, now));
  }

  // Ajustes junto do confirmar: só o dono, só em `proposed` (recalcula e incrementa a versão).
  // O chamador (`confirmProposal`) já abriu o savepoint que desfaz isto em qualquer recusa.
  if (input.adjustments && Object.keys(input.adjustments).length > 0) {
    if (asApprover) return fail('invalid_adjustment');
    const adjusted = await applyAdjustment(
      deps,
      tx,
      viewer,
      { proposal, items },
      { params: input.adjustments },
    );
    if (!adjusted.ok) return adjusted;
    proposal = adjusted.row;
    items = adjusted.items;
  }

  if (proposal.riskLevel === 4 && input.acknowledged !== true) {
    return fail('ack_required', await buildProposalDTO(tx, proposal, items, viewer, now));
  }

  // Permissão ATUAL de quem confirma (o aprovador usa as DELE), recarregada do banco.
  const principal = await resolveCopilotPrincipal(tx, {
    workspaceId: viewer.workspaceId,
    memberId: viewer.memberId,
    now,
  });
  if (!principal) return fail('forbidden');
  const pending = items.filter((i) => i.status === 'pending');
  if (pending.length === 0) return fail('not_confirmable');

  const executor = deps.executors.get(proposal.capability);
  if (!executor) return fail('executor_unavailable');
  const capability = capabilityOf(proposal);
  const budget = await loadCopilotBudget(tx, principal.settings, now);
  const deny = (): ProposalFailure | null => {
    const auth = authorizeWrite(principal, executor, capability, {
      budget: budget.state,
      targetCount: pending.length,
    });
    if (auth.allowed) return null;
    switch (auth.reason) {
      case 'subscription_inactive':
        return fail('subscription_inactive');
      case 'budget':
        return fail('budget');
      case 'capability_disabled':
      case 'copilot_disabled':
        return fail('capability_disabled');
      case 'role':
        return fail('forbidden');
    }
  };
  const denied = deny();
  if (denied) return denied;

  // Escopo de QUEM CONFIRMA: re-resolve os alvos pendentes sob o principal dele (ADR-003 §4).
  // No fluxo de aprovação, é isto que impede o aprovador de executar o que ele não enxerga.
  const ectx = executorContext({
    tx,
    principal,
    requestedByMemberId: proposal.requestedByMemberId ?? principal.memberId,
    proposalId: proposal.id,
    source: proposal.source,
    now,
  });
  const visible = await executor.resolveIds(ectx, pendingTargetRefs(items));
  const seen = new Set(visible.targets.map((t) => `${t.type}:${t.id}`));
  const runnable = pending.filter((i) => seen.has(`${i.targetType}:${i.targetId}`));
  const outOfScope = pending.filter((i) => !seen.has(`${i.targetType}:${i.targetId}`));
  if (runnable.length === 0) return fail('not_confirmable');

  // Nível 4: política recalculada agora (consentimento e janela podem ter mudado).
  let policyChecks = proposal.policyChecks;
  if (proposal.riskLevel === 4 && executor.policyCheck) {
    const args = executor.argsSchema.safeParse(proposal.args);
    if (!args.success) return fail('not_confirmable');
    const checks = (await executor.policyCheck(ectx, args.data, targetsOf(runnable))).map((c) =>
      PolicyCheckSchema.parse(c),
    );
    if (hasPolicyBlock(checks)) {
      const dto = await buildProposalDTO(
        tx,
        { ...proposal, policyChecks: checks },
        items,
        viewer,
        now,
      );
      return fail('policy_blocked', dto);
    }
    policyChecks = checks;
  }

  const from = proposal.status;
  const row = await copilotProposalsRepo.transition(tx, {
    id: proposal.id,
    from: ['proposed', 'awaiting_approval'],
    to: 'executing',
    expectedVersion: proposal.version,
    leaseSeconds: COPILOT_PROPOSAL_LEASE_SECONDS,
    patch: {
      confirmIdempotencyKey: input.idempotencyKey,
      confirmedAt: now,
      executedAt: now,
      executedAsMemberId: principal.memberId,
      policyChecks,
    },
  });
  if (!row) {
    // Perdeu a corrida: relê o que a outra confirmação gravou (já commitada).
    const current = await copilotProposalsRepo.getWithItems(tx, proposalId);
    if (!current) return fail('not_found');
    if (POST_CONFIRM_STATUSES.includes(current.proposal.status)) {
      return replayOrConflict(
        tx,
        current.proposal,
        current.items,
        viewer,
        input.idempotencyKey,
        now,
      );
    }
    return fail(
      'stale_proposal',
      await buildProposalDTO(tx, current.proposal, current.items, viewer, now),
    );
  }

  // Fora do escopo de quem confirma: `excluded`/`not_found`, na mesma transação do CAS.
  for (const item of outOfScope) {
    await copilotProposalsRepo.setItemStatus(tx, {
      itemId: item.id,
      from: ['pending'],
      to: 'excluded',
      patch: { errorCode: 'not_found' },
    });
  }
  const finalItems =
    outOfScope.length > 0 ? await copilotProposalsRepo.listItems(tx, proposal.id) : items;

  await recordProposalAudit(tx, {
    proposal: row,
    event: 'executing',
    from,
    actorMemberId: principal.memberId,
    counts: auditCounts(countItems(finalItems)),
    extra: {
      acknowledged: input.acknowledged === true,
      as_approver: asApprover,
      ...(outOfScope.length > 0 ? { out_of_scope: outOfScope.length } : {}),
    },
  });

  return {
    ok: true,
    status: 202,
    proposal: await buildProposalDTO(tx, row, finalItems, viewer, now),
    row,
    items: finalItems,
    start: () => startProposalExecution(deps, { workspaceId: row.workspaceId, proposalId: row.id }),
    notification: asApprover ? approvalNotification(row, 'approved') : null,
  };
}
