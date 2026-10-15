'use client';

import type { ReactNode } from 'react';
import { DataTable, StatusPill, type DataTableColumn } from '@hm/ui';
import { ResponsiveTable, type ResponsiveColumn, type ResponsiveTableEmpty } from '@/shared/components/ResponsiveTable';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { formatDate, formatNumber } from '@/shared/lib/locale';
import { DocumentStatusBadge } from './DocumentStatusBadge';
import type { KbDocument } from './types';

function Visibility({ doc }: { doc: KbDocument }): React.JSX.Element {
  return doc.visibleToAgents ? (
    <StatusPill tone="info" size="sm">
      Visível
    </StatusPill>
  ) : (
    <StatusPill tone="neutral" size="sm">
      Oculto
    </StatusPill>
  );
}

/** Data compacta de lista (uma linha, mesmo padrão de campanhas/flows/agentes). */
const LIST_DATE: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };

const tableColumns: DataTableColumn<KbDocument>[] = [
  {
    id: 'title',
    header: 'Documento',
    cell: (doc) => (
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-bold text-text">{doc.title}</span>
        <span className="truncate text-xs text-text-low">{doc.category ?? 'Sem categoria'}</span>
      </span>
    ),
  },
  { id: 'agents', header: 'Agentes', width: '8rem', cell: (doc) => <Visibility doc={doc} /> },
  {
    id: 'priority',
    header: 'Prioridade',
    numeric: true,
    width: '8rem',
    cell: (doc) => formatNumber(doc.priority),
  },
  {
    id: 'updated',
    header: 'Atualizado',
    numeric: true,
    width: '8rem',
    cell: (doc) => (
      <span className="whitespace-nowrap text-text-mid">
        {formatDate(doc.updatedAt ?? doc.createdAt, LIST_DATE)}
      </span>
    ),
  },
  { id: 'status', header: 'Indexação', width: '9.5rem', cell: (doc) => <DocumentStatusBadge status={doc.status} /> },
];

const cardColumns: ResponsiveColumn<KbDocument>[] = [
  { id: 'title', card: 'primary', cell: (doc) => doc.title },
  {
    id: 'meta',
    card: 'secondary',
    cell: (doc) => (
      <>
        {doc.category ?? 'Sem categoria'} ·{' '}
        <span className="font-mono tabular-nums">prioridade {formatNumber(doc.priority)}</span>
      </>
    ),
  },
  {
    id: 'agents',
    card: 'meta',
    cell: (doc) => (doc.visibleToAgents ? 'Visível aos agentes' : 'Oculto dos agentes'),
  },
  { id: 'status', card: 'badge', cell: (doc) => <DocumentStatusBadge status={doc.status} /> },
];

/**
 * Lista de documentos da KB (F3-S06; DS 3.0 na F72-S07). Desktop: `DataTable`
 * (prioridade e data em mono à direita, linha abre o Drawer — UX §2.1). Mobile: cards.
 * Vazio, carregando e erro ficam dentro da própria tabela/lista.
 */
export function DocumentList({
  documents,
  selectedId,
  onSelect,
  loading,
  error,
  errorCopy,
  empty,
  emptyCopy,
}: {
  documents: KbDocument[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  /** Nó de erro do desktop (`<ErrorState>`); `undefined` sem erro. */
  error: ReactNode;
  errorCopy: { title: string; reason: string; whatToDo: string; action: ReactNode } | null;
  empty: ReactNode;
  emptyCopy: ResponsiveTableEmpty;
}) {
  const { isMobile } = useBreakpoint();

  if (isMobile) {
    return (
      <ResponsiveTable<KbDocument>
        ariaLabel="Documentos da base de conhecimento"
        rows={documents}
        columns={cardColumns}
        getRowId={(d) => d.id}
        onRowClick={(d) => onSelect(d.id)}
        rowLabel={(d) => `Abrir documento ${d.title}`}
        isLoading={loading}
        isError={errorCopy !== null}
        error={errorCopy ?? undefined}
        empty={emptyCopy}
        skeletonRows={5}
      />
    );
  }

  return (
    <DataTable<KbDocument>
      caption="Documentos da base de conhecimento"
      columns={tableColumns}
      rows={documents}
      getRowId={(d) => d.id}
      loading={loading}
      onRowClick={(d) => onSelect(d.id)}
      getRowLabel={(d) => `Abrir documento ${d.title}`}
      getRowState={(d) => (d.id === selectedId ? 'selected' : d.status === 'archived' ? 'muted' : undefined)}
      error={error}
      empty={empty}
    />
  );
}
