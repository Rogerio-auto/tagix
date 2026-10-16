import { StatusPill, type BadgeTone } from '@hm/ui';

export type ExecutionStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

const META: Record<ExecutionStatus, { label: string; tone: BadgeTone; live?: boolean }> = {
  running: { label: 'Em execução', tone: 'info', live: true },
  waiting: { label: 'Aguardando', tone: 'warning' },
  completed: { label: 'Concluída', tone: 'success' },
  failed: { label: 'Falhou', tone: 'danger' },
  cancelled: { label: 'Cancelada', tone: 'neutral' },
};

/** `true` enquanto a execução ainda pode avançar (e ser cancelada). */
export function isExecutionActive(status: ExecutionStatus): boolean {
  return status === 'running' || status === 'waiting';
}

export function executionStatusLabel(status: ExecutionStatus): string {
  return META[status].label;
}

/**
 * Status de uma execução de flow no `StatusPill` do DS 3.0 (F72-S07). Só "Em execução"
 * pulsa — é o único estado vivo; o pulso para sob `prefers-reduced-motion`.
 */
export function ExecutionStatusPill({ status }: { status: ExecutionStatus }) {
  const { label, tone, live } = META[status];
  return (
    <StatusPill tone={tone} size="sm" live={live}>
      {label}
    </StatusPill>
  );
}
