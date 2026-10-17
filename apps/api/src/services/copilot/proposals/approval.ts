/**
 * Pedido de aprovação (ADR-003 §7; spec §5.2): "Pedir à Bruna".
 *
 * - Só proposta `blocked` por `role`, e só o dono pede.
 * - O aprovador é escolhido de `listApprovers`, calculada NO SERVIDOR: membro ativo, outro que
 *   não o solicitante, cujo papel tem a permissão da capacidade para o volume da proposta e não
 *   está desligado na matriz do Copiloto. Id fora dessa lista → 422 `invalid_approver`.
 * - `awaiting_approval` vale 72 h. O aprovador é avisado pela cascata (`copilot_aprovacao`); na
 *   decisão (confirmar ou recusar), o solicitante também.
 * - Quem aprova confirma com as permissões DELE, reavaliadas no confirmar (`confirm.ts`), e a
 *   trilha registra `actor_member_id = aprovador`, `requested_by_member_id = solicitante`.
 */
import { and, eq, ne } from 'drizzle-orm';
import {
  copilotProposalsRepo,
  schema,
  type CopilotActionItemRow,
  type CopilotProposalRow,
  type CopilotProposalSource,
  type DbTx,
} from '@hm/db';
import {
  ApproverSchema,
  ROLES,
  can,
  capabilityAllowed,
  effectiveCapabilities,
  type Approver,
  type CapabilityKey,
  type Permission,
  type ProposalDTO,
  type Role,
} from '@hm/shared';
import type { CapabilityExecutor, TargetRef } from '../../../internal/copilot/core/executor-types';
import type { NotifiableEvent } from '../../notifications';
import type { CopilotPrincipal } from '../identity/principal';
import { recordProposalAudit } from './audit';
import { executorContext } from './context';
import { buildProposalDTO, canViewProposal, capabilityOf } from './dto';
import { auditCounts, countItems } from './items';
import { APPROVAL_TTL_SECONDS, fail, type ProposalEngineDeps, type ProposalFailure } from './types';

const ROLE_ORDER: ReadonlyMap<string, number> = new Map(ROLES.map((r, i) => [r, i]));

function isRole(value: string): value is Role {
  return ROLE_ORDER.has(value);
}

/**
 * Cobertura dos alvos: o aprovador precisa ENXERGAR todos os alvos da proposta (escopo fino,
 * ADR-003 §4). Um atendente que só vê os próprios negócios não aprova mover o negócio do colega.
 */
export interface ApproverCoverage {
  readonly executor: CapabilityExecutor;
  readonly targets: readonly TargetRef[];
  readonly source: CopilotProposalSource;
  readonly proposalId: string | null;
  readonly now: Date;
}

export interface ListApproversOptions {
  /** Volume real (muda a permissão de `message.send`). Default 1. */
  readonly targetCount?: number;
  /** Permissões de entidade do executor (`CapabilityExecutor.requires`). */
  readonly requires?: readonly Permission[];
  /** Com alvos conhecidos: só quem vê TODOS eles. */
  readonly coverage?: ApproverCoverage;
}

/** Principal de um candidato a aprovador: mesmo workspace, assinatura e matriz do solicitante. */
function candidatePrincipal(requester: CopilotPrincipal, id: string, role: Role): CopilotPrincipal {
  return {
    ...requester,
    memberId: id,
    requestedByMemberId: requester.memberId,
    role,
    memberStatus: 'active',
    effectiveCapabilities: effectiveCapabilities(role, requester.matrix),
  };
}

/** O candidato vê todos os alvos? (re-resolve sob o principal DELE) */
export async function coversAllTargets(
  tx: DbTx,
  principal: CopilotPrincipal,
  coverage: ApproverCoverage,
): Promise<boolean> {
  if (coverage.targets.length === 0) return true;
  const resolved = await coverage.executor.resolveIds(
    executorContext({
      tx,
      principal,
      requestedByMemberId: principal.requestedByMemberId,
      proposalId: coverage.proposalId,
      source: coverage.source,
      now: coverage.now,
    }),
    coverage.targets,
  );
  const seen = new Set(resolved.targets.map((t) => `${t.type}:${t.id}`));
  return coverage.targets.every((t) => seen.has(`${t.type}:${t.id}`));
}

/**
 * Quem pode aprovar `capability` neste workspace (sem o próprio solicitante): membro ativo cujo
 * papel tem a permissão para o volume, com as `requires`, sem a matriz desligar, e (com
 * `coverage`) que enxerga todos os alvos. Ordem: papel mais alto primeiro, depois nome.
 */
export async function listApprovers(
  tx: DbTx,
  requester: CopilotPrincipal,
  capability: CapabilityKey,
  options: ListApproversOptions = {},
): Promise<Approver[]> {
  const m = schema.members;
  const rows = await tx
    .select({ id: m.id, name: m.name, role: m.role })
    .from(m)
    .where(
      and(
        eq(m.workspaceId, requester.workspaceId),
        eq(m.status, 'active'),
        ne(m.id, requester.memberId),
      ),
    );
  const count = Math.max(1, options.targetCount ?? 1);
  const eligible = rows
    .filter(
      (r): r is { id: string; name: string | null; role: Role } =>
        isRole(r.role) &&
        capabilityAllowed(r.role, requester.matrix, capability, count).allowed &&
        (options.requires ?? []).every((perm) => isRole(r.role) && can(r.role, perm)),
    )
    .sort(
      (a, b) =>
        (ROLE_ORDER.get(a.role) ?? 99) - (ROLE_ORDER.get(b.role) ?? 99) ||
        (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR'),
    );
  const covered: typeof eligible = [];
  for (const r of eligible) {
    if (
      !options.coverage ||
      (await coversAllTargets(tx, candidatePrincipal(requester, r.id, r.role), options.coverage))
    ) {
      covered.push(r);
    }
  }
  return covered.map((r) =>
    ApproverSchema.parse({
      member_id: r.id,
      name: ((r.name ?? '').trim() || 'Membro').slice(0, 120),
      role: r.role,
    }),
  );
}

/** Alvos (referências) dos itens ainda pendentes de uma proposta. */
export function pendingTargetRefs(items: readonly CopilotActionItemRow[]): TargetRef[] {
  return items
    .filter((i) => i.status === 'pending')
    .map((i) => ({ type: i.targetType, id: i.targetId }));
}

/** Evento da cascata para o aprovador (pedido) ou para o solicitante (decisão ou prazo). */
export function approvalNotification(
  row: CopilotProposalRow,
  kind: 'requested' | 'approved' | 'rejected' | 'expired',
): NotifiableEvent | null {
  const memberId = kind === 'requested' ? row.approverMemberId : row.requestedByMemberId;
  if (!memberId) return null;
  const titulo =
    kind === 'requested'
      ? 'Pedido de aprovação'
      : kind === 'approved'
        ? 'Seu pedido foi aprovado'
        : kind === 'rejected'
          ? 'Seu pedido foi recusado'
          : 'Seu pedido de aprovação expirou sem resposta';
  return {
    workspaceId: row.workspaceId,
    memberId,
    evento: 'copilot_aprovacao',
    eventKey: `copilot_aprovacao:${kind === 'requested' ? 'request' : 'decision'}:${row.id}`,
    titulo,
    origem: 'Copiloto',
    url: `/copilot/atividade?proposta=${row.id}`,
  };
}

/** Avisa sem nunca falhar o request (a cascata registra a própria supressão). */
export async function notifySafely(
  deps: ProposalEngineDeps,
  event: NotifiableEvent | null,
): Promise<void> {
  if (!event) return;
  try {
    await deps.notify(event);
  } catch (err) {
    deps.logger.warn('copilot-proposals: falha ao notificar', {
      evento: event.evento,
      errorName: err instanceof Error ? err.name : typeof err,
    });
  }
}

export interface ApprovalRequested {
  readonly ok: true;
  readonly proposal: ProposalDTO;
  readonly row: CopilotProposalRow;
  readonly items: CopilotActionItemRow[];
  /** Avisar depois do commit. */
  readonly notification: NotifiableEvent | null;
}

export async function requestApproval(
  deps: ProposalEngineDeps,
  tx: DbTx,
  viewer: CopilotPrincipal,
  proposalId: string,
  approverMemberId: string,
): Promise<ApprovalRequested | ProposalFailure> {
  const now = deps.now();
  const loaded = await copilotProposalsRepo.getWithItems(tx, proposalId);
  if (!loaded || !canViewProposal(loaded.proposal, viewer)) return fail('not_found');
  const { proposal, items } = loaded;
  if (proposal.requestedByMemberId !== viewer.memberId) return fail('forbidden');

  // Repetir o mesmo pedido devolve o estado atual (duplo clique).
  if (proposal.status === 'awaiting_approval' && proposal.approverMemberId === approverMemberId) {
    return {
      ok: true,
      proposal: await buildProposalDTO(tx, proposal, items, viewer, now),
      row: proposal,
      items,
      notification: null,
    };
  }
  if (proposal.status !== 'blocked' || proposal.blockedReason !== 'role') {
    return fail('not_blocked_by_role');
  }

  const counts = countItems(items);
  const executor = deps.executors.get(proposal.capability);
  if (!executor) return fail('executor_unavailable');
  const approvers = await listApprovers(tx, viewer, capabilityOf(proposal), {
    targetCount: counts.pending,
    ...(executor.requires ? { requires: executor.requires } : {}),
    coverage: {
      executor,
      targets: pendingTargetRefs(items),
      source: proposal.source,
      proposalId: proposal.id,
      now,
    },
  });
  if (!approvers.some((a) => a.member_id === approverMemberId)) return fail('invalid_approver');

  const row = await copilotProposalsRepo.transition(tx, {
    id: proposal.id,
    from: ['blocked'],
    to: 'awaiting_approval',
    expectedVersion: proposal.version,
    patch: {
      approverMemberId,
      expiresAt: new Date(now.getTime() + APPROVAL_TTL_SECONDS * 1000),
    },
  });
  if (!row) return fail('stale_proposal');
  await recordProposalAudit(tx, {
    proposal: row,
    event: 'awaiting_approval',
    from: 'blocked',
    actorMemberId: viewer.memberId,
    counts: auditCounts(counts),
  });
  return {
    ok: true,
    proposal: await buildProposalDTO(tx, row, items, viewer, now),
    row,
    items,
    notification: approvalNotification(row, 'requested'),
  };
}
