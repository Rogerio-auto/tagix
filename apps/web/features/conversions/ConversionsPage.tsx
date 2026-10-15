'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, SearchX, Target } from 'lucide-react';
import {
  AnchoredHelpHint,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Modal,
  StatusPill,
  useToast,
  type DataTableColumn,
} from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import {
  ResponsiveTable,
  type ActiveFilterChip,
  type ResponsiveColumn,
} from '@/shared/components/ResponsiveTable';
import { Skeleton } from '@/shared/components/feedback';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { cn } from '@/shared/lib/cn';
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  formatTotals,
  sumByCurrency,
} from '@/shared/lib/locale';
import { useCancelConversion, useConversionTypes, useConversions } from './queries';
import type { ConversionEvent } from './types';

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  deal_won: 'Negócio ganho',
  api: 'API',
};

const selectClass =
  'h-10 rounded-sm border border-border bg-surface-2 px-3 font-body text-base text-text outline-none ' +
  'transition-[border-color,box-shadow] duration-(--dur-base) ease-ds hover:border-border-2 ' +
  'focus:border-brand-text focus-visible:focus-ring sm:text-sm';

function Stat({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading: boolean;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface px-5 py-4">
      <span className="font-mono text-xs font-medium uppercase tracking-widest text-text-low">{label}</span>
      {loading ? (
        <Skeleton className="h-8 w-28" />
      ) : (
        <span className="truncate font-mono text-h4 font-medium tabular-nums tracking-tight text-text md:text-h3">
          {value}
        </span>
      )}
    </div>
  );
}

/**
 * Página /conversions (F5-S13; DS 3.0 na F72-S07): resultado do filtro no topo (contagem e
 * soma por moeda, em mono), `DataTable` no desktop e cards no mobile (`ResponsiveTable`,
 * filtro de tipo no bottom-sheet). Cancelar pede confirmação (UX §2.9) e fica
 * `aria-disabled` em empresa só leitura.
 */
export function ConversionsPage(): React.JSX.Element {
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const typesQuery = useConversionTypes();
  const [typeFilter, setTypeFilter] = useState('');
  const query = typeFilter ? `?conversionTypeId=${encodeURIComponent(typeFilter)}` : '';
  const eventsQuery = useConversions(query);
  const cancel = useCancelConversion();
  const [toCancel, setToCancel] = useState<ConversionEvent | null>(null);

  const types = useMemo(() => typesQuery.data?.conversionTypes ?? [], [typesQuery.data]);

  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const labelOf = (ev: ConversionEvent): string => typeById.get(ev.conversionTypeId)?.label ?? 'Conversão';

  const events = useMemo(() => eventsQuery.data?.conversions ?? [], [eventsQuery.data]);

  // Métricas derivadas no cliente (sem endpoint dedicado): contagem + soma por moeda dos
  // eventos não cancelados visíveis no filtro corrente.
  const metrics = useMemo(() => {
    const active = events.filter((ev) => ev.cancelledAt == null);
    const totals = sumByCurrency(active.map((ev) => ({ cents: ev.valueCents, currency: ev.currency })));
    return { count: active.length, total: formatTotals(totals) };
  }, [events]);

  const selectedTypeLabel = typeFilter ? typeById.get(typeFilter)?.label : undefined;

  const activeFilters = useMemo<ActiveFilterChip[]>(() => {
    if (!typeFilter) return [];
    return [
      {
        id: 'type',
        label: `Tipo: ${selectedTypeLabel ?? typeFilter}`,
        onClear: () => setTypeFilter(''),
      },
    ];
  }, [typeFilter, selectedTypeLabel]);

  function confirmCancel(): void {
    if (!toCancel) return;
    cancel.mutate(
      { id: toCancel.id },
      {
        onSuccess: () => {
          toast({ variant: 'success', title: 'Conversão cancelada.' });
          setToCancel(null);
        },
        onError: (err) => toast({ variant: 'error', title: err.message }),
      },
    );
  }

  const filterControls = (
    <select
      value={typeFilter}
      onChange={(e) => setTypeFilter(e.target.value)}
      aria-label="Filtrar por tipo"
      className={selectClass}
    >
      <option value="">Todos os tipos</option>
      {types.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
        </option>
      ))}
    </select>
  );

  const cancelAction = (ev: ConversionEvent): React.JSX.Element =>
    ev.cancelledAt ? (
      <StatusPill tone="neutral" size="sm">
        Cancelada
      </StatusPill>
    ) : (
      <ReadOnlyGuard>
        <Button variant="ghost" size="sm" onClick={() => setToCancel(ev)}>
          Cancelar
        </Button>
      </ReadOnlyGuard>
    );

  const typeCell = (ev: ConversionEvent): React.JSX.Element => {
    const color = typeById.get(ev.conversionTypeId)?.color;
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        {/* A cor é dado do tipo (cadastrada pelo cliente): só no ponto, nunca no texto. */}
        <i
          aria-hidden
          className="size-2 shrink-0 rounded-pill bg-text-low"
          style={color ? { backgroundColor: color } : undefined}
        />
        <span className={cn('truncate font-bold', ev.cancelledAt ? 'text-text-low line-through' : 'text-text')}>
          {labelOf(ev)}
        </span>
      </span>
    );
  };

  const tableColumns: DataTableColumn<ConversionEvent>[] = [
    { id: 'type', header: 'Tipo', cell: typeCell },
    {
      id: 'when',
      header: 'Quando',
      width: '11rem',
      cell: (ev) => <span className="font-mono text-sm tabular-nums">{formatDateTime(ev.occurredAt)}</span>,
    },
    {
      id: 'source',
      header: 'Origem',
      width: '10rem',
      cell: (ev) => SOURCE_LABEL[ev.source] ?? ev.source,
    },
    {
      id: 'value',
      header: 'Valor',
      numeric: true,
      width: '10rem',
      cell: (ev) => (
        <span className={ev.cancelledAt ? 'text-text-low line-through' : undefined}>
          {formatMoney(ev.valueCents, ev.currency)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Ações</span>,
      headerLabel: 'Ações',
      align: 'right',
      width: '8rem',
      cell: cancelAction,
    },
  ];

  const cardColumns: ResponsiveColumn<ConversionEvent>[] = [
    { id: 'type', card: 'primary', cell: labelOf },
    {
      id: 'when',
      card: 'secondary',
      cell: (ev) => (
        <span className="font-mono tabular-nums">
          {formatDateTime(ev.occurredAt)} · {SOURCE_LABEL[ev.source] ?? ev.source}
        </span>
      ),
    },
    {
      id: 'value',
      card: 'meta',
      cell: (ev) => (
        <span className="font-mono font-semibold tabular-nums text-text">
          {formatMoney(ev.valueCents, ev.currency)}
        </span>
      ),
    },
    { id: 'actions', card: 'badge', cell: cancelAction },
  ];

  const errorCopy = {
    title: 'Não foi possível carregar as conversões',
    reason: 'A lista de conversões não respondeu.',
    whatToDo: 'Verifique a conexão e tente novamente.',
    action: (
      <Button variant="secondary" size="sm" onClick={() => void eventsQuery.refetch()}>
        Tentar de novo
      </Button>
    ),
  };
  const emptyCopy = typeFilter
    ? {
        icon: SearchX,
        title: 'Nenhuma conversão deste tipo',
        description: 'Troque o tipo no filtro ou volte para todos.',
      }
    : {
        icon: Target,
        title: 'Nenhuma conversão registrada',
        description: 'As conversões marcadas nas conversas e negócios aparecem aqui.',
      };

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Conversões"
        description="O que virou resultado: vendas, agendamentos e metas marcadas nas conversas."
        helpSlot={<AnchoredHelpHint anchorKey="conversions.overview" />}
      />

      <div className="flex flex-col gap-4">
        <section aria-label="Resultado do filtro" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Stat label="Conversões" value={formatNumber(metrics.count)} loading={eventsQuery.isLoading} />
          <Stat label="Valor total" value={metrics.total} loading={eventsQuery.isLoading} />
        </section>

        {isMobile ? (
          <ResponsiveTable<ConversionEvent>
            ariaLabel="Conversões"
            rows={events}
            columns={cardColumns}
            getRowId={(ev) => ev.id}
            filters={filterControls}
            filtersTitle="Filtrar conversões"
            activeFilters={activeFilters}
            onClearFilters={typeFilter ? () => setTypeFilter('') : undefined}
            isLoading={eventsQuery.isLoading}
            isError={eventsQuery.isError}
            error={errorCopy}
            empty={emptyCopy}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">{filterControls}</div>
            <DataTable<ConversionEvent>
              caption="Conversões"
              columns={tableColumns}
              rows={events}
              getRowId={(ev) => ev.id}
              loading={eventsQuery.isLoading}
              getRowState={(ev) => (ev.cancelledAt ? 'muted' : undefined)}
              error={eventsQuery.isError ? <ErrorState {...errorCopy} /> : undefined}
              empty={
                <EmptyState
                  variant={typeFilter ? 'no-results' : 'first-run'}
                  {...emptyCopy}
                  secondaryAction={
                    typeFilter ? (
                      <Button variant="ghost" size="sm" onClick={() => setTypeFilter('')}>
                        Ver todos os tipos
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
          </>
        )}
      </div>

      {/* Cancelar desfaz o resultado contado no dashboard: confirmação simples (UX §2.9). */}
      <Modal
        open={toCancel !== null}
        onClose={() => setToCancel(null)}
        title="Cancelar esta conversão?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setToCancel(null)} disabled={cancel.isPending}>
              Manter
            </Button>
            <ReadOnlyGuard>
              <Button variant="danger" loading={cancel.isPending} onClick={confirmCancel}>
                Cancelar conversão
              </Button>
            </ReadOnlyGuard>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-sm border border-danger/25 bg-danger/10 text-danger"
          >
            <AlertTriangle className="size-5" />
          </span>
          <p className="font-body text-sm text-text-mid">
            {toCancel ? (
              <>
                <span className="font-bold text-text">{labelOf(toCancel)}</span> de{' '}
                <span className="font-mono tabular-nums">{formatDateTime(toCancel.occurredAt)}</span>
                {toCancel.valueCents != null && (
                  <>
                    {' '}
                    (
                    <span className="font-mono tabular-nums">
                      {formatMoney(toCancel.valueCents, toCancel.currency)}
                    </span>
                    )
                  </>
                )}{' '}
                deixa de contar no resultado. O registro continua no histórico como cancelado.
              </>
            ) : null}
          </p>
        </div>
      </Modal>
    </div>
  );
}
