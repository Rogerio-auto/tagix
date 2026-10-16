import type { SupportThreadPriorityT, SupportThreadStatusT } from '@hm/shared';
import { Badge, type BadgeTone } from '@hm/ui';

/** Selos de status e prioridade do suporte (DS 3.0, F72-S08): o `Badge` do `@hm/ui`. */
export const STATUS_LABEL: Record<SupportThreadStatusT, string> = {
  open: 'Aberto',
  pending: 'Aguardando',
  resolved: 'Resolvido',
};
const STATUS_TONE: Record<SupportThreadStatusT, BadgeTone> = {
  open: 'brand',
  pending: 'warning',
  resolved: 'neutral',
};

export const PRIORITY_LABEL: Record<SupportThreadPriorityT, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
};
const PRIORITY_TONE: Record<SupportThreadPriorityT, BadgeTone> = {
  low: 'neutral',
  normal: 'neutral',
  high: 'danger',
};

export function StatusBadge({ status }: { status: SupportThreadStatusT }) {
  return (
    <Badge tone={STATUS_TONE[status]} size="sm" dot>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** Prioridade do thread; só "Alta" ganha cor. */
export function PriorityBadge({ priority }: { priority: SupportThreadPriorityT }) {
  return (
    <Badge tone={PRIORITY_TONE[priority]} size="sm">
      {PRIORITY_LABEL[priority]}
    </Badge>
  );
}
