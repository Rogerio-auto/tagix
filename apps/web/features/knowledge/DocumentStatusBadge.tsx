import { cn } from '@/shared/lib/cn';
import type { KbDocumentStatus } from './types';

type Tone = 'ok' | 'processing' | 'muted';

// `draft` = criado e aguardando indexação (mostrado como "Processando" ao usuário —
// honesto sobre o estado real sem CTA falso, UX §3).
const STATUS_META: Record<KbDocumentStatus, { label: string; tone: Tone }> = {
  active: { label: 'Indexado', tone: 'ok' },
  draft: { label: 'Processando', tone: 'processing' },
  archived: { label: 'Arquivado', tone: 'muted' },
};

const toneClass: Record<Tone, string> = {
  ok: 'bg-success/15 text-success',
  processing: 'bg-warn/15 text-warn',
  muted: 'bg-surface-3 text-text-low',
};

const dotClass: Record<Tone, string> = {
  ok: 'bg-success',
  processing: 'bg-warn animate-pulse',
  muted: 'bg-text-low',
};

export function DocumentStatusBadge({ status }: { status: KbDocumentStatus }) {
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
