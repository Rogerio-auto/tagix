'use client';

import type { DealHistoryEntry } from './types';

const EVENT_LABEL: Record<DealHistoryEntry['eventType'], string> = {
  created: 'Negócio criado',
  stage_changed: 'Mudou de estágio',
  field_updated: 'Campo atualizado',
  owner_changed: 'Responsável alterado',
  closed: 'Negócio fechado',
  reopened: 'Negócio reaberto',
  note_added: 'Nota adicionada',
  attachment_added: 'Anexo adicionado',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Timeline de deal_history (F5-S10, PIPELINE.md §9.3). */
export function HistoryTimeline({ entries }: { entries: DealHistoryEntry[] }): React.JSX.Element {
  if (entries.length === 0) {
    return <p className="text-sm text-text-low">Sem histórico ainda.</p>;
  }
  return (
    <ol className="flex flex-col gap-3">
      {entries.map((entry) => (
        <li key={entry.id} className="flex gap-3">
          <span className="mt-1 size-2 shrink-0 rounded-full bg-accent" aria-hidden />
          <div className="flex flex-col">
            <span className="text-sm text-text">{EVENT_LABEL[entry.eventType]}</span>
            <span className="text-xs text-text-low">
              {formatDate(entry.createdAt)} · {entry.actorType}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
