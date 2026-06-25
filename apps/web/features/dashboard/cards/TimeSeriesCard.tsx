'use client';

/**
 * Card de série temporal (DASHBOARD §3 — desempenho 30d). Plota a janela de 30 dias
 * como gráfico de linha com um toggle para alternar entre 3 séries: Resolvidas,
 * Conversões e Novos contatos. Consome `card.value.series` do `desempenho_30d`.
 *
 * Padrão: importa recharts diretamente; o registry (S08) o carrega via `lazyClient`
 * ({ ssr:false, loading: ChartSkeleton }) — tirando a lib do First Load JS e
 * segurando a forma do card enquanto o chunk baixa (UX §3.6). Tokens DS, zero hex.
 */
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/shared/lib/cn';
import type { DashboardCard, MetricValue } from '../types';

interface SeriesRow {
  readonly day: string;
  readonly resolvidas: number;
  readonly conversoes: number;
  readonly conversoes_valor_cents: number;
  readonly novos_contatos: number;
}

type SeriesKey = 'resolvidas' | 'conversoes' | 'novos_contatos';

const SERIES_OPTIONS: ReadonlyArray<{ readonly key: SeriesKey; readonly label: string }> = [
  { key: 'resolvidas', label: 'Resolvidas' },
  { key: 'conversoes', label: 'Conversões' },
  { key: 'novos_contatos', label: 'Novos contatos' },
];

/** Coerção tolerante a value malformado: number finito, ou parse de string, ou 0. */
function toNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Lê com segurança a série do jsonb `value`; lista vazia se ausente/malformado. */
function readSeries(value: MetricValue | null): SeriesRow[] {
  if (!value) return [];
  const raw = value['series'];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
    .map((p) => ({
      day: typeof p['day'] === 'string' ? p['day'] : '',
      resolvidas: toNum(p['resolvidas']),
      conversoes: toNum(p['conversoes']),
      conversoes_valor_cents: toNum(p['conversoes_valor_cents']),
      novos_contatos: toNum(p['novos_contatos']),
    }));
}

/** ISO date `YYYY-MM-DD` → `dd/MM` (sem deslocamento de timezone). */
function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = m[2];
  const day = m[3];
  if (!month || !day) return iso;
  return `${day}/${month}`;
}

interface TimeSeriesCardProps {
  card: DashboardCard;
  onDrill?: (card: DashboardCard) => void;
}

export function TimeSeriesCard({ card, onDrill }: TimeSeriesCardProps): React.JSX.Element {
  const series = useMemo(() => readSeries(card.value), [card.value]);
  const [active, setActive] = useState<SeriesKey>('resolvidas');

  const activeLabel = SERIES_OPTIONS.find((o) => o.key === active)?.label ?? '';
  const interactive = Boolean(onDrill);

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col rounded-lg border border-border bg-surface p-4 transition-colors sm:p-5',
        interactive && 'hover:border-border-brand',
      )}
    >
      {/* Cabeçalho: rótulo + toggle de série (UX §3.5 — estados de seleção claros). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-head text-sm font-medium text-text">{card.label}</span>
        <div role="group" aria-label="Série exibida" className="flex items-center gap-1">
          {SERIES_OPTIONS.map((option) => {
            const selected = option.key === active;
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={selected}
                onClick={() => setActive(option.key)}
                className={cn(
                  'rounded-md px-2 py-1 font-body text-xs transition-colors outline-none',
                  'focus-visible:shadow-glow-md',
                  selected
                    ? 'bg-surface-3 text-text'
                    : 'text-text-low hover:bg-surface-2 hover:text-text',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Área do gráfico = ação primária (drill por drawer, §4 — nunca modal full).
          Altura por breakpoint + ResponsiveContainer 100%: nunca estoura a viewport
          no mobile (UX §8 / MOBILE_UX §1.7). */}
      <button
        type="button"
        onClick={interactive ? () => onDrill?.(card) : undefined}
        aria-label={interactive ? `Abrir detalhe de ${card.label}` : undefined}
        className={cn(
          'mt-4 h-56 w-full rounded-md outline-none sm:h-52',
          'focus-visible:shadow-glow-md',
          interactive ? 'cursor-pointer' : 'cursor-default',
        )}
      >
        {series.length === 0 ? (
          <div className="flex h-full items-center justify-center font-body text-sm text-text-low">
            Sem dados no período.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="day"
                tickFormatter={formatDay}
                tick={{ fill: 'var(--text-low)', fontSize: 11 }}
                minTickGap={24}
              />
              <YAxis tick={{ fill: 'var(--text-low)', fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                cursor={{ stroke: 'var(--border)' }}
                labelFormatter={(label) => formatDay(String(label))}
                contentStyle={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text)',
                }}
              />
              <Line
                type="monotone"
                dataKey={active}
                name={activeLabel}
                stroke="var(--brand)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: 'var(--brand)' }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </button>
    </div>
  );
}
