'use client';

/**
 * Card de estatística (DASHBOARD §3 — os blocos numéricos do topo). Clicável quando
 * tem drill-down: navega para a página filtrada (§4) OU, se o caller passar
 * `onDrill`, abre o drawer lateral. Modal full-screen é proibido (§4 / UX §2.3).
 *
 * O valor é derivado do jsonb `value` por metric_key — formatação numérica/monetária
 * conforme a chave presente (count | valueCents | costUsd). Sem dado → "—" (o card
 * existe porque o server o enviou, mas o número ainda não foi computado).
 */
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import type { DashboardCard } from '../types';
import { formatBRLFromCents, formatDuration, formatInt, formatPercent, formatUSD, readNumber } from '../format';

function displayValue(card: DashboardCard): string {
  const v = card.value;
  if (!v) return '—';
  // Contrato Onda A (F28-S01): { value, unit } — duração (s), latência (ms) ou % .
  const value = readNumber(v, 'value');
  if (value !== null) {
    const unit = typeof v['unit'] === 'string' ? (v['unit'] as string) : '';
    if (unit === 's') return formatDuration(value);
    if (unit === '%') return formatPercent(value);
    if (unit === 'ms') return `${formatInt(value)} ms`;
    return formatInt(value);
  }
  const cents = readNumber(v, 'valueCents');
  const usd = readNumber(v, 'costUsd');
  const count = readNumber(v, 'count');
  if (count !== null && cents !== null) {
    return `${formatInt(count)} · ${formatBRLFromCents(cents)}`;
  }
  if (cents !== null) return formatBRLFromCents(cents);
  if (usd !== null) return formatUSD(usd);
  if (count !== null) return formatInt(count);
  return '—';
}

/**
 * Estado de alerta de um card stat (Onda A). Hoje só `cap_mensal_consumido_pct`:
 * ≥100% danger, ≥80% warn, abaixo neutro. Mapeia para tokens DS (sem hex).
 */
type StatTone = 'neutral' | 'warn' | 'danger';

function statTone(card: DashboardCard): StatTone {
  if (card.key !== 'cap_mensal_consumido_pct') return 'neutral';
  const pct = readNumber(card.value, 'value');
  if (pct === null) return 'neutral';
  if (pct >= 100) return 'danger';
  if (pct >= 80) return 'warn';
  return 'neutral';
}

const TONE_BORDER: Record<StatTone, string> = {
  neutral: 'border-border',
  warn: 'border-warn/50',
  danger: 'border-danger/60',
};
const TONE_VALUE: Record<StatTone, string> = {
  neutral: 'text-text',
  warn: 'text-warn',
  danger: 'text-danger',
};

interface StatCardProps {
  card: DashboardCard;
  onDrill?: (card: DashboardCard) => void;
}

export function StatCard({ card, onDrill }: StatCardProps) {
  const value = displayValue(card);
  const interactive = Boolean(card.drillHref) || Boolean(onDrill);
  const tone = statTone(card);

  const inner = (
    <div
      className={cn(
        'group flex h-full flex-col justify-between rounded-lg border bg-surface p-5 transition-colors',
        TONE_BORDER[tone],
        interactive && 'hover:border-border-brand hover:bg-surface-2',
      )}
    >
      <div className="flex items-start justify-between">
        <span className="font-body text-xs uppercase tracking-wide text-text-low">{card.label}</span>
        {interactive && (
          <ArrowUpRight
            size={16}
            className="text-text-low opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
      </div>
      <span className={cn('mt-3 font-price text-2xl', TONE_VALUE[tone])}>{value}</span>
    </div>
  );

  // Drill-down por drawer tem prioridade quando o caller pede (conteúdo compacto);
  // senão navega para a página filtrada (§4).
  if (onDrill) {
    return (
      <button type="button" onClick={() => onDrill(card)} className="block w-full text-left">
        {inner}
      </button>
    );
  }
  if (card.drillHref) {
    return (
      <Link href={card.drillHref} className="block">
        {inner}
      </Link>
    );
  }
  return inner;
}
