import { cn } from '@/shared/lib/cn';
import type { FlowStatus } from './types';

type Tone = 'ok' | 'warn' | 'off' | 'muted';

const STATUS_META: Record<FlowStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Rascunho', tone: 'muted' },
  active: { label: 'Ativo', tone: 'ok' },
  paused: { label: 'Pausado', tone: 'warn' },
  archived: { label: 'Arquivado', tone: 'off' },
};

const toneClass: Record<Tone, string> = {
  ok: 'bg-success/15 text-success',
  warn: 'bg-warning/15 text-warning',
  off: 'bg-surface-3 text-text-low',
  muted: 'bg-surface-3 text-text-low',
};

const dotClass: Record<Tone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  off: 'bg-text-low',
  muted: 'bg-text-low',
};

export function FlowStatusBadge({ status }: { status: FlowStatus }) {
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
