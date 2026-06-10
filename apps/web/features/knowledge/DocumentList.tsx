'use client';

import { Card } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { DocumentStatusBadge } from './DocumentStatusBadge';
import type { KbDocument } from './types';

/** Lista de documentos da KB (Card com linhas clicáveis). */
export function DocumentList({
  documents,
  onSelect,
}: {
  documents: KbDocument[];
  onSelect: (id: string) => void;
}) {
  return (
    <Card elevation={1}>
      <ul className="divide-y divide-border-2">
        {documents.map((doc) => (
          <li key={doc.id}>
            <button
              type="button"
              onClick={() => onSelect(doc.id)}
              className={cn(
                'flex w-full items-center justify-between gap-4 px-4 py-3 text-left outline-none transition-colors',
                'hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:shadow-glow-sm',
              )}
            >
              <div className="min-w-0">
                <div className="truncate font-head text-sm font-medium text-text">{doc.title}</div>
                <div className="mt-0.5 flex items-center gap-2 font-body text-xs text-text-low">
                  {doc.category && <span>{doc.category}</span>}
                  {doc.category && <span aria-hidden>·</span>}
                  <span>{doc.visibleToAgents ? 'Visível aos agentes' : 'Oculto dos agentes'}</span>
                  <span aria-hidden>·</span>
                  <span>prioridade {doc.priority}</span>
                </div>
              </div>
              <DocumentStatusBadge status={doc.status} />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
