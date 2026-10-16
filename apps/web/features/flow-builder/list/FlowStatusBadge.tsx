import { StatusPill, type BadgeTone } from '@hm/ui';
import type { FlowStatus } from './types';

const STATUS_META: Record<FlowStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Rascunho', tone: 'neutral' },
  active: { label: 'Ativo', tone: 'success' },
  paused: { label: 'Pausado', tone: 'warning' },
  archived: { label: 'Arquivado', tone: 'neutral' },
};

/**
 * Status do flow no `StatusPill` do DS 3.0 (F72-S07). Estático: numa lista com vários
 * flows ativos o pulso viraria ruído. O texto carrega o sentido; a cor só reforça.
 */
export function FlowStatusBadge({ status, size = 'sm' }: { status: FlowStatus; size?: 'sm' | 'md' }) {
  const { label, tone } = STATUS_META[status];
  return (
    <StatusPill tone={tone} size={size}>
      {label}
    </StatusPill>
  );
}
