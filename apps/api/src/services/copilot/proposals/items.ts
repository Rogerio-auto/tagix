/**
 * Forma persistida dos itens (`copilot_action_items.before/after`) e contagens (F73-S05).
 *
 *   before = { label, display, state }            // rótulo e "antes" legíveis + estado lido
 *   after  = { display, planned, state?, conflict_by? }
 *
 * `planned` é o estado que a prévia prometeu; `state` é o estado real gravado pelo executor na
 * execução (o desfazer confere contra ele); `conflict_by` é o nome de quem editou o alvo entre a
 * prévia e a execução ("parei em dois que a Paula estava editando").
 */
import type { CopilotActionItemRow } from '@hm/db';
import type { ProposalItem, ProposalProgress } from '@hm/shared';
import type {
  ExecutableItem,
  Json,
  UndoableItem,
} from '../../../internal/copilot/core/executor-types';

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null;
}

export function itemLabel(item: CopilotActionItemRow): string {
  return str(item.before?.['label'], 200) ?? 'Item';
}

export function itemBeforeState(item: CopilotActionItemRow): Json | null {
  const state = item.before?.['state'];
  return isJson(state) ? state : null;
}

export function itemPlannedAfter(item: CopilotActionItemRow): Json | null {
  const planned = item.after?.['planned'];
  return isJson(planned) ? planned : null;
}

/** Estado real depois da execução (ou o planejado, se o executor não devolveu). */
export function itemExecutedAfter(item: CopilotActionItemRow): Json | null {
  const state = item.after?.['state'];
  return isJson(state) ? state : itemPlannedAfter(item);
}

export function encodeBefore(input: {
  readonly label: string;
  readonly display: string | null;
  readonly state: Json;
}): Json {
  return { label: input.label.slice(0, 200), display: input.display, state: input.state };
}

export function encodeAfter(input: {
  readonly display: string | null;
  readonly planned: Json | null;
}): Json {
  return { display: input.display, planned: input.planned };
}

export function toExecutableItem(item: CopilotActionItemRow): ExecutableItem {
  return {
    id: item.id,
    targetType: item.targetType,
    targetId: item.targetId,
    label: itemLabel(item),
    expectedVersion: item.expectedVersion,
    before: itemBeforeState(item),
    plannedAfter: itemPlannedAfter(item),
  };
}

export function toUndoableItem(item: CopilotActionItemRow): UndoableItem {
  return {
    id: item.id,
    targetType: item.targetType,
    targetId: item.targetId,
    label: itemLabel(item),
    expectedVersion: item.expectedVersion,
    before: itemBeforeState(item),
    after: itemExecutedAfter(item),
    undoPayload: item.undoPayload ?? null,
  };
}

/** Motivo legível de um item pulado, que falhou ou não foi desfeito. Sem PII de contato. */
export function itemReason(item: CopilotActionItemRow): string | null {
  switch (item.status) {
    case 'skipped_conflict': {
      const by = str(item.after?.['conflict_by'], 120);
      return by ? `Editado por ${by} depois da prévia` : 'Mudou depois da prévia';
    }
    case 'skipped_policy':
      return 'Pulado pela checagem de política';
    case 'failed':
      return item.errorCode === 'not_found'
        ? 'Não encontrado no seu escopo'
        : 'Não foi possível concluir';
    case 'undo_conflict':
      return item.errorCode === 'undo_failed'
        ? 'Não foi possível desfazer'
        : 'Mudou depois da execução; não foi desfeito';
    case 'excluded':
      return item.errorCode === 'not_found' ? 'Não encontrado no seu escopo' : 'Excluído no ajuste';
    default:
      return null;
  }
}

export function toProposalItem(item: CopilotActionItemRow): ProposalItem {
  return {
    id: item.id,
    target_type: item.targetType,
    target_id: item.targetId,
    label: itemLabel(item),
    before: str(item.before?.['display'], 200),
    after: str(item.after?.['display'], 200),
    status: item.status,
    reason: itemReason(item),
  };
}

export interface ItemCounts {
  /** Itens ativos (sem os excluídos). */
  readonly total: number;
  readonly pending: number;
  readonly done: number;
  readonly skipped: number;
  readonly failed: number;
  readonly undone: number;
  readonly undoConflict: number;
  readonly excluded: number;
}

export function countItems(items: readonly CopilotActionItemRow[]): ItemCounts {
  let pending = 0;
  let done = 0;
  let skipped = 0;
  let failed = 0;
  let undone = 0;
  let undoConflict = 0;
  let excluded = 0;
  for (const item of items) {
    switch (item.status) {
      case 'pending':
        pending++;
        break;
      case 'done':
        done++;
        break;
      case 'skipped_conflict':
      case 'skipped_policy':
        skipped++;
        break;
      case 'failed':
        failed++;
        break;
      case 'undone':
        undone++;
        break;
      case 'undo_conflict':
        undoConflict++;
        break;
      case 'excluded':
        excluded++;
        break;
    }
  }
  return {
    total: items.length - excluded,
    pending,
    done,
    skipped,
    failed,
    undone,
    undoConflict,
    excluded,
  };
}

/**
 * Progresso público: `done` conta o que foi executado (inclusive o que depois foi desfeito ou
 * deu conflito no desfazer); `failed` soma pulados e falhas.
 */
export function progressOf(counts: ItemCounts): ProposalProgress {
  return {
    done: counts.done + counts.undone + counts.undoConflict,
    total: counts.total,
    failed: counts.failed + counts.skipped,
  };
}

/** Contagens sem PII para `audit_logs.metadata.counts`. */
export function auditCounts(counts: ItemCounts): Record<string, number> {
  return {
    total: counts.total,
    pending: counts.pending,
    done: counts.done,
    skipped: counts.skipped,
    failed: counts.failed,
    undone: counts.undone,
    undo_conflict: counts.undoConflict,
    excluded: counts.excluded,
  };
}
