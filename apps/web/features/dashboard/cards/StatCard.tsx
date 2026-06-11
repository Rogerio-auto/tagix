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
import { formatBRLFromCents, formatInt, formatUSD, readNumber } from '../format';

function displayValue(card: DashboardCard): string {
  const v = card.value;
  if (!v) return '—';
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

interface StatCardProps {
  card: DashboardCard;
  onDrill?: (card: DashboardCard) => void;
}

export function StatCard({ card, onDrill }: StatCardProps) {
  const value = displayValue(card);
  const interactive = Boolean(card.drillHref) || Boolean(onDrill);

  const inner = (
    <div
      className={cn(
        'group flex h-full flex-col justify-between rounded-lg border border-border bg-surface p-5 transition-colors',
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
      <span className="mt-3 font-price text-2xl text-text">{value}</span>
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
