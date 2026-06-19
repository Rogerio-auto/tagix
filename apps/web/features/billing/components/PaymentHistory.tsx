'use client';

/**
 * Histórico de cobranças (ledger payment_events). Tabela densa no desktop, lista
 * de cards no mobile (ResponsiveTable — regra de ouro isMobile=estrutura, F36).
 * Trata empty/loading/error pelos 3 estados (UX §2.6/§2.7/§2.11). Read-only.
 */
import { Receipt } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import {
  ResponsiveTable,
  type ResponsiveColumn,
} from '@/shared/components/ResponsiveTable';
import type { PaymentEvent } from '../queries';
import { eventStatusPresentation, eventTypeLabel, formatBRL, formatDate } from '../format';

interface PaymentHistoryProps {
  events: readonly PaymentEvent[];
  isLoading: boolean;
  isError: boolean;
}

const columns: readonly ResponsiveColumn<PaymentEvent>[] = [
  {
    id: 'type',
    header: 'Evento',
    card: 'primary',
    cell: (e) => <span className="font-head font-medium">{eventTypeLabel(e.eventType)}</span>,
  },
  {
    id: 'date',
    header: 'Data',
    card: 'secondary',
    cell: (e) => <span className="text-text-mid">{formatDate(e.receivedAt)}</span>,
  },
  {
    id: 'amount',
    header: 'Valor',
    align: 'right',
    card: 'meta',
    cell: (e) => <span className="font-price">{formatBRL(e.amountCents)}</span>,
  },
  {
    id: 'status',
    header: 'Status',
    align: 'right',
    card: 'badge',
    cell: (e) => {
      const s = eventStatusPresentation(e.status);
      return (
        <span className={cn('rounded-pill px-2 py-0.5 font-head text-xs font-semibold', s.badgeClass)}>
          {s.label}
        </span>
      );
    },
  },
];

export function PaymentHistory({ events, isLoading, isError }: PaymentHistoryProps) {
  return (
    <ResponsiveTable<PaymentEvent>
      ariaLabel="Histórico de cobranças"
      rows={events}
      columns={columns}
      getRowId={(e) => e.id}
      isLoading={isLoading}
      isError={isError}
      empty={{
        icon: Receipt,
        title: 'Sem cobranças ainda',
        description: 'Quando houver pagamentos, eles aparecerão aqui com data, valor e status.',
      }}
      error={{
        title: 'Não foi possível carregar o histórico',
        reason: 'Houve uma falha ao buscar suas cobranças.',
        whatToDo: 'Atualize a página em instantes.',
      }}
      skeletonRows={4}
    />
  );
}
