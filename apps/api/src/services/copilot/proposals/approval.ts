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
  type DbTx,
} from '@hm/db';
import {
  ApproverSchema,
  ROLES,
  capabilityAllowed,
  type Approver,
  type CapabilityKey,
  type ProposalDTO,
  type Role,
} from '@hm/shared';
import type { NotifiableEvent } from '../../notifications';
import type { CopilotPrincipal } from '../identity/principal';
import { recordProposalAudit } from './audit';
import { buildProposalDTO, canViewProposal, capabilityOf } from './dto';
import { auditCounts, countItems } from './items';
import { APPROVAL_TTL_SECONDS, fail, type ProposalEngineDeps, type ProposalFailure } from './types';

const ROLE_ORDER: ReadonlyMap<string, number> = new Map(ROLES.map((r, i) => [r, i]));

function isRole(value: string): value is Role {
  return ROLE_ORDER.has(value);
}

/**
 * Quem pode aprovar `capability` com `targetCount` alvos neste workspace (sem o próprio
 * solicitante). Ordem: papel mais alto primeiro, depois nome.
 */
export async function listApprovers(
  tx: DbTx,
  requester: CopilotPrincipal,
  capability: CapabilityKey,
  targetCount: number,
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
  const count = Math.max(1, targetCount);
  return rows
    .filter(
      (r): r is { id: string; name: string | null; role: Role } =>
        isRole(r.role) && capabilityAllowed(r.role, requester.matrix, capability, count).allowed,
    )
    .sort(
      (a, b) =>
        (ROLE_ORDER.get(a.role) ?? 99) - (ROLE_ORDER.get(b.role) ?? 99) ||
        (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR'),
    )
    .map((r) =>
      ApproverSchema.parse({
        member_id: r.id,
        name: ((r.name ?? '').trim() || 'Membro').slice(0, 120),
        role: r.role,
      }),
    );
}

/** Evento da cascata para o aprovador (pedido) ou para o solicitante (decisão). */
export function approvalNotification(
  row: CopilotProposalRow,
  kind: 'requested' | 'approved' | 'rejected',
): NotifiableEvent | null {
  const memberId = kind === 'requested' ? row.approverMemberId : row.requestedByMemberId;
  if (!memberId) return null;
  const titulo =
    kind === 'requested'
      ? 'Pedido de aprovação'
      : kind === 'approved'
        ? 'Seu pedido foi aprovado'
        : 'Seu pedido foi recusado';
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
  const approvers = await listApprovers(tx, viewer, capabilityOf(proposal), counts.total);
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
