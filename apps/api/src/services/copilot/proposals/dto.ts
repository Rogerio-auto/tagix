/**
 * DTOs públicos do motor (F73-S05): `ProposalDTO` e `ActivityEntry` (`@hm/shared`).
 *
 * `can_confirm` e `can_undo` são calculados para QUEM LÊ (dono, aprovador ou gestor): a
 * interface não tem regra de risco nem de permissão (ADR-004 §Consequências). Toda saída passa
 * pelo schema `.strict()` do contrato antes de sair: deriva de contrato falha aqui, no servidor,
 * e não no navegador.
 */
import { inArray } from 'drizzle-orm';
import {
  schema,
  type CopilotActionItemRow,
  type CopilotActivityEntry,
  type CopilotProposalRow,
  type DbTx,
} from '@hm/db';
import {
  ActivityEntrySchema,
  CapabilityKeySchema,
  PolicyCheckSchema,
  ProposalDTOSchema,
  ProposalPreviewSchema,
  can,
  capabilityAllowed,
  type ActivityEntry,
  type CapabilityKey,
  type MemberRef,
  type PolicyCheck,
  type ProposalDTO,
  type ProposalPreview,
} from '@hm/shared';
import type { CopilotPrincipal } from '../identity/principal';
import { countItems, progressOf, toProposalItem } from './items';
import { UNDOABLE_STATUSES } from './types';

/** Membro removido (FK `SET NULL`): a trilha continua legível. */
const REMOVED_MEMBER: MemberRef = {
  member_id: '00000000-0000-0000-0000-000000000000',
  name: 'Membro removido',
};

export type MemberNames = ReadonlyMap<string, string>;

/** Nomes dos membros citados (1 query). Sem e-mail nem telefone: só `name`. */
export async function loadMemberNames(
  tx: DbTx,
  ids: readonly (string | null | undefined)[],
): Promise<MemberNames> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: schema.members.id, name: schema.members.name })
    .from(schema.members)
    .where(inArray(schema.members.id, unique));
  return new Map(rows.map((r) => [r.id, (r.name ?? '').trim() || 'Membro']));
}

function memberRef(id: string | null, names: MemberNames): MemberRef | null {
  if (!id) return null;
  return { member_id: id, name: (names.get(id) ?? 'Membro').slice(0, 120) };
}

export function capabilityOf(row: Pick<CopilotProposalRow, 'capability'>): CapabilityKey {
  return CapabilityKeySchema.parse(row.capability);
}

export function previewOf(row: Pick<CopilotProposalRow, 'preview'>): ProposalPreview {
  return ProposalPreviewSchema.parse(row.preview);
}

export function policyChecksOf(
  row: Pick<CopilotProposalRow, 'policyChecks'>,
): PolicyCheck[] | null {
  if (!row.policyChecks) return null;
  return row.policyChecks.map((c) => PolicyCheckSchema.parse(c));
}

export function hasPolicyBlock(checks: readonly PolicyCheck[] | null): boolean {
  return (checks ?? []).some((c) => c.status === 'block');
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/** O papel de quem lê pode executar a capacidade com este volume? (papel ∧ matriz ∧ assinatura) */
function viewerCanAct(viewer: CopilotPrincipal, capability: CapabilityKey, count: number): boolean {
  if (viewer.memberStatus !== 'active' || !viewer.settings.enabled) return false;
  if (viewer.subscription.inactive) return false;
  return capabilityAllowed(viewer.role, viewer.matrix, capability, Math.max(1, count)).allowed;
}

/** O leitor pode confirmar agora? */
export function computeCanConfirm(
  row: CopilotProposalRow,
  items: readonly CopilotActionItemRow[],
  viewer: CopilotPrincipal,
  now: Date,
): boolean {
  if (!row.expiresAt || row.expiresAt.getTime() <= now.getTime()) return false;
  if (hasPolicyBlock(policyChecksOf(row))) return false;
  const counts = countItems(items);
  if (counts.pending === 0) return false;
  const capability = capabilityOf(row);
  if (row.status === 'proposed') {
    return (
      row.requestedByMemberId === viewer.memberId &&
      viewerCanAct(viewer, capability, counts.pending)
    );
  }
  if (row.status === 'awaiting_approval') {
    return (
      row.approverMemberId === viewer.memberId && viewerCanAct(viewer, capability, counts.pending)
    );
  }
  return false;
}

/** O leitor pode desfazer agora? (dono ou `copilot.activity.view_all`, com a capacidade) */
export function computeCanUndo(
  row: Pick<
    CopilotProposalRow,
    'status' | 'undoDeadline' | 'undoneAt' | 'requestedByMemberId' | 'capability'
  >,
  doneCount: number,
  viewer: CopilotPrincipal,
  now: Date,
): boolean {
  if (!UNDOABLE_STATUSES.includes(row.status)) return false;
  if (!row.undoDeadline || row.undoDeadline.getTime() <= now.getTime()) return false;
  if (row.undoneAt) return false;
  if (doneCount === 0) return false;
  const owner = row.requestedByMemberId === viewer.memberId;
  if (!owner && !can(viewer.role, 'copilot.activity.view_all')) return false;
  return viewerCanAct(viewer, capabilityOf(row), doneCount);
}

/** O leitor pode VER a proposta? (dono, aprovador, quem executou ou gestor) Senão: 404. */
export function canViewProposal(row: CopilotProposalRow, viewer: CopilotPrincipal): boolean {
  return (
    row.requestedByMemberId === viewer.memberId ||
    row.approverMemberId === viewer.memberId ||
    row.executedAsMemberId === viewer.memberId ||
    can(viewer.role, 'copilot.activity.view_all')
  );
}

export function toProposalDTO(
  row: CopilotProposalRow,
  items: readonly CopilotActionItemRow[],
  viewer: CopilotPrincipal,
  names: MemberNames,
  now: Date,
): ProposalDTO {
  const counts = countItems(items);
  const dto: ProposalDTO = {
    id: row.id,
    source: row.source,
    capability: capabilityOf(row),
    risk_level: row.riskLevel,
    status: row.status,
    summary: row.summary,
    preview: previewOf(row),
    policy_checks: policyChecksOf(row),
    items: {
      data: items.map(toProposalItem),
      total: items.length,
      next_cursor: null,
    },
    progress: progressOf(counts),
    requested_by: memberRef(row.requestedByMemberId, names) ?? REMOVED_MEMBER,
    approver: memberRef(row.approverMemberId, names),
    expires_at: iso(row.expiresAt),
    undo_deadline: iso(row.undoDeadline),
    version: row.version,
    can_confirm: computeCanConfirm(row, items, viewer, now),
    can_undo: computeCanUndo(row, counts.done, viewer, now),
    blocked_reason: row.blockedReason,
    created_at: row.createdAt.toISOString(),
  };
  return ProposalDTOSchema.parse(dto);
}

/** Carrega nomes e monta o DTO (atalho usado por todos os serviços). */
export async function buildProposalDTO(
  tx: DbTx,
  row: CopilotProposalRow,
  items: readonly CopilotActionItemRow[],
  viewer: CopilotPrincipal,
  now: Date,
): Promise<ProposalDTO> {
  const names = await loadMemberNames(tx, [row.requestedByMemberId, row.approverMemberId]);
  return toProposalDTO(row, items, viewer, names, now);
}

export function toActivityEntry(
  row: CopilotActivityEntry,
  viewer: CopilotPrincipal,
  names: MemberNames,
  now: Date,
): ActivityEntry {
  const c = row.itemCounts;
  const entry: ActivityEntry = {
    id: row.id,
    at: row.createdAt.toISOString(),
    source: row.source,
    requested_by: memberRef(row.requestedByMemberId, names),
    executed_as: memberRef(row.executedAsMemberId, names),
    approver: memberRef(row.approverMemberId, names),
    capability: capabilityOf(row),
    risk_level: row.riskLevel,
    status: row.status,
    summary: row.summary,
    counts: {
      total: c.total - c.excluded,
      done: c.done,
      skipped: c.skipped,
      failed: c.failed,
      undone: c.undone,
    },
    can_undo: computeCanUndo(row, c.done, viewer, now),
    undo_deadline: iso(row.undoDeadline),
    blocked_reason: row.blockedReason,
  };
  return ActivityEntrySchema.parse(entry);
}
