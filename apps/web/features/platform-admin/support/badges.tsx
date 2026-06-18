import type { SupportThreadPriorityT, SupportThreadStatusT } from '@hm/shared';

const STATUS_LABEL: Record<SupportThreadStatusT, string> = {
  open: 'Aberto',
  pending: 'Aguardando',
  resolved: 'Resolvido',
};
const STATUS_CLS: Record<SupportThreadStatusT, string> = {
  open: 'bg-brand/15 text-brand',
  pending: 'bg-warn/15 text-warn',
  resolved: 'bg-surface-3 text-text-low',
};

const PRIORITY_LABEL: Record<SupportThreadPriorityT, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
};
const PRIORITY_CLS: Record<SupportThreadPriorityT, string> = {
  low: 'bg-surface-3 text-text-low',
  normal: 'bg-surface-2 text-text-mid',
  high: 'bg-danger/15 text-danger',
};

export function StatusBadge({ status }: { status: SupportThreadStatusT }) {
  return (
    <span
      className={
        'shrink-0 rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' +
        STATUS_CLS[status]
      }
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: SupportThreadPriorityT }) {
  return (
    <span
      className={
        'shrink-0 rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' +
        PRIORITY_CLS[priority]
      }
    >
      {PRIORITY_LABEL[priority]}
    </span>
  );
}
