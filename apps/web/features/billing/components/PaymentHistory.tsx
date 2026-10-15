'use client';

/**
 * Histórico de cobranças (ledger payment_events). Desktop: `DataTable` operacional
 * (valor e data em mono à direita); mobile: cards (`ResponsiveTable` — regra de ouro
 * isMobile=estrutura, F36). Trata vazio/carregando/erro (UX §2.6/§2.7/§2.11). Só leitura.
 */
import { Receipt } from 'lucide-react';
import { DataTable, EmptyState, ErrorState, StatusPill, type DataTableColumn } from '@hm/ui';
import { ResponsiveTable, type ResponsiveColumn } from '@/shared/components/ResponsiveTable';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import type { PaymentEvent } from '../queries';
import { eventStatusPresentation, eventTypeLabel, formatBRL, formatDate } from '../format';

interface PaymentHistoryProps {
  events: readonly PaymentEvent[];
  isLoading: boolean;
  isError: boolean;
}

function EventStatus({ status }: { status: string }): React.JSX.Element {
  const s = eventStatusPresentation(status);
  return (
    <StatusPill tone={s.tone} size="sm">
      {s.label}
    </StatusPill>
  );
}

const tableColumns: DataTableColumn<PaymentEvent>[] = [
  {
    id: 'type',
    header: 'Evento',
    cell: (e) => <span className="font-bold text-text">{eventTypeLabel(e.eventType)}</span>,
  },
  { id: 'status', header: 'Status', width: '9rem', cell: (e) => <EventStatus status={e.status} /> },
  { id: 'date', header: 'Data', numeric: true, width: '11rem', cell: (e) => formatDate(e.receivedAt) },
  { id: 'amount', header: 'Valor', numeric: true, width: '10rem', cell: (e) => formatBRL(e.amountCents) },
];

const cardColumns: readonly ResponsiveColumn<PaymentEvent>[] = [
  { id: 'type', card: 'primary', cell: (e) => eventTypeLabel(e.eventType) },
  {
    id: 'date',
    card: 'secondary',
    cell: (e) => <span className="font-mono tabular-nums">{formatDate(e.receivedAt)}</span>,
  },
  {
    id: 'amount',
    card: 'meta',
    cell: (e) => (
      <span className="font-mono font-semibold tabular-nums text-text">{formatBRL(e.amountCents)}</span>
    ),
  },
  { id: 'status', card: 'badge', cell: (e) => <EventStatus status={e.status} /> },
];

const EMPTY = {
  icon: Receipt,
  title: 'Sem cobranças ainda',
  description: 'Quando houver pagamentos, eles aparecerão aqui com data, valor e status.',
};
const ERROR = {
  title: 'Não foi possível carregar o histórico',
  reason: 'Houve uma falha ao buscar suas cobranças.',
  whatToDo: 'Atualize a página em instantes.',
};

export function PaymentHistory({ events, isLoading, isError }: PaymentHistoryProps) {
  const { isMobile } = useBreakpoint();

  if (isMobile) {
    return (
      <ResponsiveTable<PaymentEvent>
        ariaLabel="Histórico de cobranças"
        rows={events}
        columns={cardColumns}
        getRowId={(e) => e.id}
        isLoading={isLoading}
        isError={isError}
        empty={EMPTY}
        error={ERROR}
        skeletonRows={4}
      />
    );
  }

  return (
    <DataTable<PaymentEvent>
      caption="Histórico de cobranças"
      columns={tableColumns}
      rows={events}
      getRowId={(e) => e.id}
      loading={isLoading}
      loadingRows={4}
      density="compact"
      error={isError ? <ErrorState {...ERROR} /> : undefined}
      empty={<EmptyState variant="no-results" {...EMPTY} />}
    />
  );
}
