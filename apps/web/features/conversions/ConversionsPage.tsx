'use client';

import { useMemo, useState } from 'react';
import { Target } from 'lucide-react';
import { useToast } from '@hm/ui';
import {
  ResponsiveTable,
  type ActiveFilterChip,
  type ResponsiveColumn,
} from '@/shared/components/ResponsiveTable';
import { useCancelConversion, useConversionTypes, useConversions } from './queries';
import type { ConversionEvent } from './types';

function formatBRL(cents: number | null, currency: string): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);
}

/**
 * Página /conversions (F5-S13): lista filtrada por tipo + cancelar.
 * Responsiva (F36-S10): métricas full-width no topo, tabela densa em md+ e cards
 * em mobile via `ResponsiveTable` (filtro de tipo no bottom-sheet).
 */
export function ConversionsPage(): React.JSX.Element {
  const { toast } = useToast();
  const typesQuery = useConversionTypes();
  const [typeFilter, setTypeFilter] = useState('');
  const query = typeFilter ? `?conversionTypeId=${typeFilter}` : '';
  const eventsQuery = useConversions(query);
  const cancel = useCancelConversion();

  const types = typesQuery.data?.conversionTypes ?? [];

  const typeLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of types) map.set(t.id, t.label);
    return map;
  }, [types]);

  const events = useMemo(() => eventsQuery.data?.conversions ?? [], [eventsQuery.data]);

  // Métricas leves derivadas no cliente (sem endpoint dedicado): contagem + soma
  // por moeda dos eventos não cancelados visíveis no filtro corrente.
  const metrics = useMemo(() => {
    const active = events.filter((ev) => ev.cancelledAt == null);
    const byCurrency = new Map<string, number>();
    for (const ev of active) {
      if (ev.valueCents == null) continue;
      byCurrency.set(ev.currency, (byCurrency.get(ev.currency) ?? 0) + ev.valueCents);
    }
    const total = [...byCurrency.entries()]
      .map(([currency, cents]) => formatBRL(cents, currency))
      .join(' · ');
    return { count: active.length, total: total || '—' };
  }, [events]);

  const selectedTypeLabel = typeFilter ? typeLabel.get(typeFilter) : undefined;

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

  const filterControls = (
    <select
      value={typeFilter}
      onChange={(e) => setTypeFilter(e.target.value)}
      aria-label="Filtrar por tipo"
      className="touch-target rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:shadow-glow-md"
    >
      <option value="">Todos os tipos</option>
      {types.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
        </option>
      ))}
    </select>
  );

  const columns = useMemo<ResponsiveColumn<ConversionEvent>[]>(
    () => [
      {
        id: 'type',
        header: 'Tipo',
        card: 'primary',
        cell: (ev) => (
          <span className="font-medium text-text">
            {typeLabel.get(ev.conversionTypeId) ?? 'Conversão'}
          </span>
        ),
      },
      {
        id: 'when',
        header: 'Quando',
        card: 'secondary',
        cell: (ev) => (
          <span className="text-text-low">
            {new Date(ev.occurredAt).toLocaleString('pt-BR')} · {ev.source}
          </span>
        ),
      },
      {
        id: 'value',
        header: 'Valor',
        align: 'right',
        card: 'meta',
        cell: (ev) => (
          <span className="text-text-mid">{formatBRL(ev.valueCents, ev.currency)}</span>
        ),
      },
      {
        id: 'actions',
        header: 'Ações',
        align: 'right',
        card: 'meta',
        cell: (ev) =>
          ev.cancelledAt ? (
            <span className="text-xs text-text-low">Cancelada</span>
          ) : (
            <button
              type="button"
              disabled={cancel.isPending}
              onClick={(e) => {
                e.stopPropagation();
                cancel.mutate(
                  { id: ev.id },
                  {
                    onSuccess: () => toast({ variant: 'success', title: 'Conversão cancelada.' }),
                    onError: (err) => toast({ variant: 'error', title: err.message }),
                  },
                );
              }}
              className="touch-target rounded-md px-2 text-xs text-text-low outline-none hover:text-danger focus-visible:shadow-glow-md disabled:opacity-40"
            >
              Cancelar
            </button>
          ),
      },
    ],
    [typeLabel, cancel, toast],
  );

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-head text-lg font-semibold text-text">Conversões</h1>
      </header>

      {/* Métricas: grid 2-col em md+, coluna única full-width em mobile. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs uppercase tracking-wide text-text-low">Conversões</div>
          <div className="mt-1 font-head text-2xl font-semibold text-text">{metrics.count}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs uppercase tracking-wide text-text-low">Valor total</div>
          <div className="mt-1 font-head text-2xl font-semibold text-text">{metrics.total}</div>
        </div>
      </div>

      <ResponsiveTable<ConversionEvent>
        ariaLabel="Conversões"
        rows={events}
        columns={columns}
        getRowId={(ev) => ev.id}
        filters={filterControls}
        filtersTitle="Filtrar conversões"
        activeFilters={activeFilters}
        onClearFilters={typeFilter ? () => setTypeFilter('') : undefined}
        isLoading={eventsQuery.isLoading}
        isError={eventsQuery.isError}
        error={{
          title: 'Não foi possível carregar as conversões',
          reason: 'A lista de conversões não respondeu.',
          whatToDo: 'Verifique a conexão e tente novamente.',
        }}
        empty={{
          icon: Target,
          title: 'Nenhuma conversão registrada',
          description: 'As conversões marcadas nas conversas e negócios aparecem aqui.',
        }}
      />
    </div>
  );
}
