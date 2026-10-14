'use client';

/**
 * Receita atribuída ao longo do período (a "linha que sobe" da maquete). SVG puro, sem
 * biblioteca de gráfico: nada de recharts no First Load da Home.
 *
 * Esta é a ÚNICA superfície da tela que usa o verde da marca (a linha e o brilho sob
 * ela); todo o resto do bloco é neutro. Passe o ponteiro ou use as setas para ler um dia.
 *
 * Honestidade: série zerada vira uma reta na base com a mensagem "sem receita", e sem
 * tipo de conversão configurado a tela convida a configurar em vez de plotar um zero.
 */
import type * as React from 'react';
import { useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LineChart } from 'lucide-react';
import { Button } from '@hm/ui';
import { formatRevenue, buildChartGeometry } from './home-format';
import { Panel } from './Panel';
import type { HomeRevenuePoint } from './types';

const W = 640;
const H = 168;

/**
 * O verde da marca sobre o branco do tema claro dá menos de 3:1 (WCAG 1.4.11, objeto
 * gráfico). No claro, a linha e o anel do marcador usam `--brand-text` (o verde
 * escurecido do próprio token, por tema); o degradê sob a linha segue no `--brand`,
 * que ali é só atmosfera. Variante arbitrária do Tailwind sobre o `data-theme` do
 * `<html>`: nenhum token novo, nenhum hex.
 */
const LINE_STROKE = 'stroke-brand [[data-theme=light]_&]:stroke-brand-text';
const MARKER_BORDER = 'border-brand [[data-theme=light]_&]:border-brand-text';

/** `YYYY-MM-DD` como data LOCAL (new Date('YYYY-MM-DD') seria UTC e recuaria um dia). */
function localDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function dayLabel(day: string): string {
  return localDate(day).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

export function RevenueChart({
  series,
  periodDays,
}: {
  series: readonly HomeRevenuePoint[] | null;
  periodDays: number;
}): React.JSX.Element {
  const router = useRouter();
  const titleId = useId();
  const gradientId = useId();
  const [active, setActive] = useState<number | null>(null);

  const geometry = useMemo(() => (series ? buildChartGeometry(series, W, H) : null), [series]);

  if (series === null || geometry === null) {
    return (
      <Panel id={titleId} eyebrow={`${periodDays} dias`} title="Receita atribuída">
        <div className="flex flex-col items-start gap-4 px-4 py-8 sm:px-6">
          <span className="flex size-10 items-center justify-center rounded-md border border-border-2 bg-surface-2 text-text-low">
            <LineChart aria-hidden className="size-5" />
          </span>
          <div>
            <p className="font-body text-sm font-bold text-text">Falta um tipo de conversão</p>
            <p className="mt-1 max-w-md font-body text-sm text-text-mid">
              A receita atribuída aparece quando a empresa define o que conta como conversão (venda,
              orçamento aprovado) e o valor de cada uma.
            </p>
          </div>
          <Button variant="secondary" onClick={() => router.push('/conversions')}>
            Configurar conversões
          </Button>
        </div>
      </Panel>
    );
  }

  const empty = geometry.total === 0;
  const last = series.length - 1;
  const shownIndex = active ?? last;
  const shown = series[shownIndex];
  const point = geometry.points[shownIndex];
  const mid = series[Math.floor(last / 2)];

  const onMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || last <= 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setActive(Math.round(ratio * last));
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setActive(Math.max(0, shownIndex - 1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setActive(Math.min(last, shownIndex + 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(last);
    } else if (e.key === 'Escape') {
      setActive(null);
    }
  };

  return (
    <Panel
      id={titleId}
      eyebrow={`${periodDays} dias`}
      title="Receita atribuída"
      flush
      aside={
        <span className="text-right">
          <span className="block font-mono text-lg font-medium tabular-nums text-text">
            {formatRevenue(geometry.total)}
          </span>
          <span className="block font-body text-xs text-text-low">no período</span>
        </span>
      }
    >
      <div className="px-2 pb-4 pt-2 sm:px-4">
        <div
          role="group"
          tabIndex={0}
          aria-label={`Receita por dia, ${periodDays} dias. Use as setas para ler cada dia.`}
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          className="relative cursor-crosshair rounded-md focus-visible:focus-ring"
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="block h-40 w-full sm:h-48"
            aria-hidden
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: 'var(--brand)', stopOpacity: 0.28 }} />
                <stop offset="1" style={{ stopColor: 'var(--brand)', stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((r) => (
              <line
                key={r}
                x1="0"
                x2={W}
                y1={H * r}
                y2={H * r}
                className="stroke-border"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {!empty && <path d={geometry.area} fill={`url(#${gradientId})`} />}
            <path
              d={geometry.line}
              fill="none"
              className={empty ? 'stroke-border-2' : LINE_STROKE}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {!empty && point && shown && (
            <>
              {active !== null && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 w-px bg-border-2"
                  style={{ left: `${(point.x / W) * 100}%` }}
                />
              )}
              <span
                aria-hidden
                className={`pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-pill border-2 bg-surface ${MARKER_BORDER}`}
                style={{ left: `${(point.x / W) * 100}%`, top: `${(point.y / H) * 100}%` }}
              />
              {/* Leitura do dia só sob demanda (ponteiro/setas): em repouso o total
                  do período, no cabeçalho, já responde. */}
              {active !== null && (
                <span
                  className="pointer-events-none absolute top-1 whitespace-nowrap rounded-sm border border-border-2 bg-surface-2 px-2 py-1 font-mono text-xs tabular-nums text-text"
                  style={{
                    left: `${(point.x / W) * 100}%`,
                    transform:
                      point.x > W / 2 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)',
                  }}
                >
                  {dayLabel(shown.day)} · {formatRevenue(shown.valueCents)}
                </span>
              )}
            </>
          )}

          {empty && (
            <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center font-body text-sm text-text-mid">
              Nenhuma receita registrada neste período.
            </p>
          )}
        </div>

        <div className="mt-2 flex justify-between px-2 font-mono text-xs text-text-low">
          <span>{series[0] ? dayLabel(series[0].day) : ''}</span>
          <span className="hidden sm:inline">{mid ? dayLabel(mid.day) : ''}</span>
          <span>{series[last] ? dayLabel(series[last].day) : ''}</span>
        </div>
        <p className="sr-only" aria-live="polite">
          {active !== null && shown
            ? `${dayLabel(shown.day)}: ${formatRevenue(shown.valueCents)}`
            : ''}
        </p>
      </div>
    </Panel>
  );
}
