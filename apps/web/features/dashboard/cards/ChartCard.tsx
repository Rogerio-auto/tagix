'use client';

/**
 * Card de gráfico (DASHBOARD §3.2/§3.3 — tendências). Renderiza a série do `value`
 * com recharts (lib leve). Clicar abre o drawer de drill-down (série completa) —
 * nunca modal full-screen (§4). Para AGENT não há ChartCard (server não envia §10).
 *
 * Suporta duas formas de value:
 *  - `{ series: [{ bucket_hour, direction, message_count }] }` (volume 24h).
 *  - `{ byType: [{ conversion_type_id, conversion_count }] }` (conversões por tipo).
 */
import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/shared/lib/cn';
import type { DashboardCard } from '../types';
import { metricContext } from '../format';

interface SeriesPoint {
  label: string;
  value: number;
}

function toPoints(card: DashboardCard): SeriesPoint[] {
  const v = card.value;
  if (!v) return [];
  // volume 24h: agrega por hora; direção embutida no metric_key (inbound/outbound).
  const series = v['series'];
  if (Array.isArray(series)) {
    const wantOutbound = card.key.includes('outbound');
    return series
      .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
      .filter((p) => (p['direction'] === 'outbound') === wantOutbound)
      .map((p) => ({
        label: typeof p['bucket_hour'] === 'string' ? p['bucket_hour'].slice(11, 16) : '',
        value: typeof p['message_count'] === 'number' ? p['message_count'] : Number(p['message_count'] ?? 0),
      }));
  }
  // conversões por tipo.
  const byType = v['byType'];
  if (Array.isArray(byType)) {
    return byType
      .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
      .map((p, i) => ({
        label: `Tipo ${i + 1}`,
        value:
          typeof p['conversion_count'] === 'number'
            ? p['conversion_count']
            : Number(p['conversion_count'] ?? 0),
      }));
  }
  return [];
}

interface ChartCardProps {
  card: DashboardCard;
  onDrill?: (card: DashboardCard) => void;
}

export function ChartCard({ card, onDrill }: ChartCardProps) {
  const points = useMemo(() => toPoints(card), [card]);
  const caption = metricContext(card.key);

  return (
    <button
      type="button"
      onClick={onDrill ? () => onDrill(card) : undefined}
      className={cn(
        'flex h-full w-full flex-col rounded-lg border border-border bg-surface p-4 text-left transition-colors sm:p-5',
        onDrill && 'hover:border-border-brand',
      )}
    >
      {/* Nome + legenda de contexto (clareza §2.4 — o que o gráfico mostra). */}
      <span className="font-head text-sm font-medium text-text">{card.label}</span>
      {caption && <span className="mt-0.5 font-body text-xs text-text-low">{caption}</span>}
      {/* Altura por breakpoint; largura 100% via ResponsiveContainer — nunca
          estoura a viewport no mobile (F36-S06 / MOBILE_UX §1.7). */}
      <div className="mt-4 h-56 w-full sm:h-52">
        {points.length === 0 ? (
          <div className="flex h-full items-center justify-center font-body text-sm text-text-low">
            Sem dados no período.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-low)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--text-low)', fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'var(--surface-2)' }}
                contentStyle={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text)',
                }}
              />
              {/* Dado em verde MUTED (var(--brand-strong)): o neon pleno fica reservado
                  ao único KPI primário do topo (regra DS "1 verde por tela"). */}
              <Bar dataKey="value" fill="var(--brand-strong)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </button>
  );
}
