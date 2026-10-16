import { StatusPill, type BadgeTone } from '@hm/ui';
import type { KbDocumentStatus } from './types';

// `draft` = criado e aguardando indexação (mostrado como "Processando" ao usuário —
// honesto sobre o estado real sem CTA falso, UX §3). É o único estado vivo: só ele pulsa
// (Signal pulse do DS 3.0, estático sob `prefers-reduced-motion`).
const STATUS_META: Record<KbDocumentStatus, { label: string; tone: BadgeTone; live: boolean }> = {
  active: { label: 'Indexado', tone: 'success', live: false },
  draft: { label: 'Processando', tone: 'warning', live: true },
  archived: { label: 'Arquivado', tone: 'neutral', live: false },
};

export function DocumentStatusBadge({ status }: { status: KbDocumentStatus }) {
  const { label, tone, live } = STATUS_META[status];
  return (
    <StatusPill tone={tone} size="sm" live={live}>
      {label}
    </StatusPill>
  );
}
