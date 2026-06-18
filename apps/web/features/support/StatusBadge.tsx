import type { SupportThreadStatusT } from '@hm/shared';

const LABEL: Record<SupportThreadStatusT, string> = {
  open: 'Aberto',
  pending: 'Aguardando',
  resolved: 'Resolvido',
};

const CLS: Record<SupportThreadStatusT, string> = {
  open: 'bg-brand/15 text-brand',
  pending: 'bg-warn/15 text-warn',
  resolved: 'bg-surface-3 text-text-low',
};

export function StatusBadge({ status }: { status: SupportThreadStatusT }) {
  return (
    <span
      className={
        'shrink-0 rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' +
        CLS[status]
      }
    >
      {LABEL[status]}
    </span>
  );
}
