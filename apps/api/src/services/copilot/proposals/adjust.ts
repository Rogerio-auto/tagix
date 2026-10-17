/**
 * Ajustar uma proposta antes do confirmar (ADR-004 §2): excluir itens e trocar os parâmetros
 * que o executor declarou ajustáveis (`adjustableParams`). Só o dono, só em `proposed`.
 *
 * Ajustar RECALCULA tudo: re-resolve os alvos restantes sob o escopo (estado e versão novos),
 * refaz a prévia, o nível de risco e, no nível 4, a política; e incrementa `version` (o CAS
 * do confirmar recusa uma confirmação feita sobre a prévia antiga).
 */
import {
  copilotProposalsRepo,
  type CopilotActionItemRow,
  type CopilotProposalRow,
  type DbTx,
} from '@hm/db';
import {
  CAPABILITIES,
  PolicyCheckSchema,
  classifyRisk,
  isRiskRefused,
  type AdjustProposalInput,
  type PolicyCheck,
  type ProposalAdjustParams,
  type ProposalDTO,
} from '@hm/shared';
import type {
  CapabilityExecutor,
  ExecutorContext,
  Target,
} from '../../../internal/copilot/core/executor-types';
import type { CopilotPrincipal } from '../identity/principal';
import { recordProposalAudit } from './audit';
import { buildProposalDTO, canViewProposal } from './dto';
import { auditCounts, countItems, encodeAfter, encodeBefore, itemLabel } from './items';
import { argsJson, buildPreviewJson, readTurnTainted, summaryOf } from './propose';
import { PROPOSAL_TTL_SECONDS, fail, type ProposalEngineDeps, type ProposalFailure } from './types';

export interface Adjusted {
  readonly ok: true;
  readonly row: CopilotProposalRow;
  readonly items: CopilotActionItemRow[];
}

const ADJUST_PARAM_KEYS = ['target_stage_id', 'notify_members', 'pause_instead'] as const;

/**
 * Aplica o ajuste numa proposta `proposed` já carregada e conferida (dono, versão, prazo).
 * Usado pelo `/adjust` e pelo `adjustments` do `/confirm`.
 */
export async function applyAdjustment(
  deps: ProposalEngineDeps,
  tx: DbTx,
  viewer: CopilotPrincipal,
  loaded: { readonly proposal: CopilotProposalRow; readonly items: CopilotActionItemRow[] },
  input: { readonly excludeItemIds?: readonly string[]; readonly params?: ProposalAdjustParams },
): Promise<Adjusted | ProposalFailure> {
  const { proposal, items } = loaded;
  const now = deps.now();
  const executor: CapabilityExecutor | undefined = deps.executors.get(proposal.capability);
  if (!executor) return fail('executor_unavailable');
  const stored = executor.argsSchema.safeParse(proposal.args);
  if (!stored.success) return fail('invalid_adjustment');

  // Itens a excluir: precisam ser desta proposta e estar pendentes.
  const exclude = new Set(input.excludeItemIds ?? []);
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const id of exclude) {
    if (byId.get(id)?.status !== 'pending') return fail('invalid_adjustment');
  }

  // Parâmetros: só os declarados pelo executor.
  let args: unknown = stored.data;
  const params = input.params;
  if (params) {
    const keys = ADJUST_PARAM_KEYS.filter((k) => params[k] !== undefined);
    const allowed = new Set(executor.adjustableParams ?? []);
    if (keys.length > 0) {
      if (!executor.applyAdjustments || keys.some((k) => !allowed.has(k))) {
        return fail('invalid_adjustment');
      }
      const next = executor.argsSchema.safeParse(executor.applyAdjustments(args, params));
      if (!next.success) return fail('invalid_adjustment');
      args = next.data;
    }
  }

  const remaining = items.filter((i) => i.status === 'pending' && !exclude.has(i.id));
  if (remaining.length === 0) return fail('invalid_adjustment');

  // Re-resolve sob o escopo: estado e versão de agora.
  const ectx: ExecutorContext = {
    tx,
    principal: viewer,
    requestedByMemberId: proposal.requestedByMemberId ?? viewer.memberId,
    proposalId: proposal.id,
    source: proposal.source,
    now,
  };
  const resolved = await executor.resolveTargets(ectx, args);
  const fresh = new Map(resolved.targets.map((t) => [`${t.type}:${t.id}`, t]));
  const kept: { item: CopilotActionItemRow; target: Target }[] = [];
  const vanished: CopilotActionItemRow[] = [];
  for (const item of remaining) {
    const target = fresh.get(`${item.targetType}:${item.targetId}`);
    if (target) kept.push({ item, target });
    else vanished.push(item);
  }
  if (kept.length === 0) return fail('invalid_adjustment');

  const targets = kept.map((k) => k.target);
  const preview = await executor.preview(ectx, args, targets);
  const tainted = await readTurnTainted(tx, proposal.turnId);
  const risk = classifyRisk({
    capability: executor.capability,
    target_count: targets.length,
    external: preview.external,
    irreversible: preview.irreversible,
    notifies_members: preview.notifiesMembers,
    turn_tainted: tainted,
  });
  if (isRiskRefused(risk)) return fail('invalid_adjustment');
  let policyChecks: PolicyCheck[] | null = null;
  if (risk.level === 4 && executor.policyCheck) {
    policyChecks = (await executor.policyCheck(ectx, args, targets)).map((c) =>
      PolicyCheckSchema.parse(c),
    );
  }

  // CAS primeiro: com a versão divergente, nada é gravado.
  // Nível 4 tem prazo menor: o ajuste nunca estica o prazo, só encurta.
  const cap4 = new Date(now.getTime() + PROPOSAL_TTL_SECONDS[4] * 1000);
  const expiresAt =
    risk.level === 4 && proposal.expiresAt && proposal.expiresAt > cap4 ? cap4 : proposal.expiresAt;
  const row = await copilotProposalsRepo.transition(tx, {
    id: proposal.id,
    from: ['proposed'],
    to: 'proposed',
    expectedVersion: proposal.version,
    patch: {
      args: argsJson(args),
      preview: buildPreviewJson(CAPABILITIES[executor.capability].label, preview),
      policyChecks,
      riskLevel: risk.level,
      summary: summaryOf(preview, CAPABILITIES[executor.capability].label),
      expiresAt,
    },
  });
  if (!row) return fail('stale_proposal');
  // Itens: excluídos, sumidos do escopo e os restantes com a prévia nova.
  for (const id of exclude) {
    await copilotProposalsRepo.setItemStatus(tx, { itemId: id, from: ['pending'], to: 'excluded' });
  }
  for (const item of vanished) {
    await copilotProposalsRepo.setItemStatus(tx, {
      itemId: item.id,
      from: ['pending'],
      to: 'excluded',
      patch: { errorCode: 'not_found' },
    });
  }
  const previewByTarget = new Map(preview.items.map((p) => [p.targetId, p]));
  for (const { item, target } of kept) {
    const p = previewByTarget.get(target.id);
    await copilotProposalsRepo.setItemStatus(tx, {
      itemId: item.id,
      from: ['pending'],
      to: 'pending',
      patch: {
        expectedVersion: target.expectedVersion,
        before: encodeBefore({
          label: target.label || itemLabel(item),
          display: p?.before ?? null,
          state: target.state,
        }),
        after: encodeAfter({ display: p?.after ?? null, planned: p?.plannedAfter ?? null }),
      },
    });
  }

  const nextItems = await copilotProposalsRepo.listItems(tx, proposal.id);
  await recordProposalAudit(tx, {
    proposal: row,
    event: 'adjusted',
    from: 'proposed',
    actorMemberId: viewer.memberId,
    counts: auditCounts(countItems(nextItems)),
    extra: {
      excluded: exclude.size + vanished.length,
      params: params ? Object.keys(params).length : 0,
    },
  });
  return { ok: true, row, items: nextItems };
}

export interface AdjustOk {
  readonly ok: true;
  readonly proposal: ProposalDTO;
  readonly row: CopilotProposalRow;
  readonly items: CopilotActionItemRow[];
}

/** `POST /api/copilot/proposals/:id/adjust`. */
export async function adjustProposal(
  deps: ProposalEngineDeps,
  tx: DbTx,
  viewer: CopilotPrincipal,
  proposalId: string,
  body: AdjustProposalInput,
): Promise<AdjustOk | ProposalFailure> {
  const now = deps.now();
  const loaded = await copilotProposalsRepo.getWithItems(tx, proposalId);
  if (!loaded || !canViewProposal(loaded.proposal, viewer)) return fail('not_found');
  const { proposal, items } = loaded;
  if (proposal.requestedByMemberId !== viewer.memberId) return fail('forbidden');
  if (proposal.status !== 'proposed') return fail('not_adjustable');
  if (!proposal.expiresAt || proposal.expiresAt.getTime() <= now.getTime()) {
    return fail('proposal_expired');
  }
  if (proposal.version !== body.version) {
    return fail('stale_proposal', await buildProposalDTO(tx, proposal, items, viewer, now));
  }
  const adjusted = await applyAdjustment(deps, tx, viewer, loaded, {
    ...(body.exclude_item_ids ? { excludeItemIds: body.exclude_item_ids } : {}),
    ...(body.params ? { params: body.params } : {}),
  });
  if (!adjusted.ok) return adjusted;
  return {
    ok: true,
    proposal: await buildProposalDTO(tx, adjusted.row, adjusted.items, viewer, now),
    row: adjusted.row,
    items: adjusted.items,
  };
}
