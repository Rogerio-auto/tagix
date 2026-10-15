import { StatusPill, type BadgeTone } from '@hm/ui';
import type { SupportThreadStatusT } from '@hm/shared';

const META: Record<SupportThreadStatusT, { label: string; tone: BadgeTone }> = {
  open: { label: 'Aberto', tone: 'info' },
  pending: { label: 'Aguardando', tone: 'warning' },
  resolved: { label: 'Resolvido', tone: 'neutral' },
};

/** Estado da conversa de suporte (DS 3.0: `StatusPill`, texto sempre presente). */
export function StatusBadge({ status }: { status: SupportThreadStatusT }) {
  const { label, tone } = META[status];
  return (
    <StatusPill tone={tone} size="sm">
      {label}
    </StatusPill>
  );
}
