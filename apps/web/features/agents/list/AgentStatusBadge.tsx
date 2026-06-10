import { cn } from '@/shared/lib/cn';
import type { AgentStatus } from '../types';

type Tone = 'ok' | 'off' | 'muted';

const STATUS_META: Record<AgentStatus, { label: string; tone: Tone }> = {
  active: { label: 'Ativo', tone: 'ok' },
  inactive: { label: 'Inativo', tone: 'off' },
  archived: { label: 'Arquivado', tone: 'muted' },
};

const toneClass: Record<Tone, string> = {
  ok: 'bg-success/15 text-success',
  off: 'bg-surface-3 text-text-low',
  muted: 'bg-surface-3 text-text-low',
};

const dotClass: Record<Tone, string> = {
  ok: 'bg-success',
  off: 'bg-text-low',
  muted: 'bg-text-low',
};

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const { label, tone } = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 font-head text-xs font-medium',
        toneClass[tone],
      )}
    >
      <span className={cn('size-1.5 rounded-pill', dotClass[tone])} aria-hidden />
      {label}
    </span>
  );
}
