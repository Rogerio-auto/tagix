'use client';

import { useMemo, useState } from 'react';
import { Card, CardBody, useToast } from '@hm/ui';
import { useCancelConversion, useConversionTypes, useConversions } from './queries';

function formatBRL(cents: number | null, currency: string): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);
}

/** Página /conversions (F5-S13): lista filtrada por tipo + cancelar. */
export function ConversionsPage(): React.JSX.Element {
  const { toast } = useToast();
  const typesQuery = useConversionTypes();
  const [typeFilter, setTypeFilter] = useState('');
  const query = typeFilter ? `?conversionTypeId=${typeFilter}` : '';
  const eventsQuery = useConversions(query);
  const cancel = useCancelConversion();

  const typeLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of typesQuery.data?.conversionTypes ?? []) map.set(t.id, t.label);
    return map;
  }, [typesQuery.data]);

  const events = eventsQuery.data?.conversions ?? [];

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold text-text">Conversões</h1>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Filtrar por tipo"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
        >
          <option value="">Todos os tipos</option>
          {(typesQuery.data?.conversionTypes ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </header>

      {eventsQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-raised" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <p className="text-sm text-text-low">Nenhuma conversão registrada.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((ev) => (
            <li key={ev.id}>
              <Card elevation={1}>
                <CardBody className="flex items-center justify-between gap-4 p-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-text">
                      {typeLabel.get(ev.conversionTypeId) ?? 'Conversão'}
                    </span>
                    <span className="text-xs text-text-low">
                      {new Date(ev.occurredAt).toLocaleString('pt-BR')} · {ev.source}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-text-mid">{formatBRL(ev.valueCents, ev.currency)}</span>
                    <button
                      type="button"
                      disabled={cancel.isPending}
                      onClick={() =>
                        cancel.mutate(
                          { id: ev.id },
                          {
                            onSuccess: () => toast({ variant: 'success', title: 'Conversão cancelada.' }),
                            onError: (e) => toast({ variant: 'error', title: e.message }),
                          },
                        )
                      }
                      className="text-xs text-text-low hover:text-danger"
                    >
                      Cancelar
                    </button>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
