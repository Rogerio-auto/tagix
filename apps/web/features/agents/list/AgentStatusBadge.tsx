import { StatusPill, type BadgeTone } from '@hm/ui';
import type { AgentStatus } from '../types';

const STATUS_META: Record<AgentStatus, { label: string; tone: BadgeTone }> = {
  active: { label: 'Ativo', tone: 'success' },
  inactive: { label: 'Inativo', tone: 'neutral' },
  archived: { label: 'Arquivado', tone: 'neutral' },
};

/**
 * Status do agente no `StatusPill` do DS 3.0. Estático de propósito: numa lista com vários
 * agentes ativos, o pulso viraria ruído. O texto carrega o sentido; a cor só reforça.
 */
export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const { label, tone } = STATUS_META[status];
  return (
    <StatusPill tone={tone} size="sm">
      {label}
    </StatusPill>
  );
}
