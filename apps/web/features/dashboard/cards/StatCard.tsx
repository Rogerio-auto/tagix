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
import {
  ArrowUpRight,
  Award,
  BarChart3,
  Bot,
  Clock,
  DollarSign,
  MessageSquare,
  Shield,
  Star,
  TrendingUp,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import type { DashboardCard } from '../types';

function metricIcon(key: string): LucideIcon {
  if (/volume|inbound|outbound|mensagem/.test(key)) return MessageSquare;
  if (/tempo|tme|tmr|duracao|latencia/.test(key)) return Clock;
  if (/conversao|conversoes/.test(key)) return TrendingUp;
  if (/satisfacao|csat|nps/.test(key)) return Star;
  if (/qualidade/.test(key)) return Award;
  if (/custo|token|cap_mensal/.test(key)) return Zap;
  if (/valor|receita|faturamento|cents/.test(key)) return DollarSign;
  if (/objecao/.test(key)) return Shield;
  if (/agente|ia/.test(key)) return Bot;
  if (/atendente|membro|equipe/.test(key)) return Users;
  return BarChart3;
}
import {
  formatBRLFromCents,
  formatDuration,
  formatInt,
  formatPercent,
  formatScore100,
  formatUSD,
  readNumber,
} from '../format';
import { CsatCard } from './CsatCard';

function displayValue(card: DashboardCard): string {
  const v = card.value;
  if (!v) return '—';
  // §F29: qualidade média é um score 0-100 → "90 / 100".
  if (card.key === 'qualidade_resposta_media') {
    return formatScore100(readNumber(v, 'value'));
  }
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
  // §F29: CSAT tem render próprio (distribuição promoter/neutral/detractor).
  if (card.key === 'satisfacao_media') {
    return <CsatCard card={card} />;
  }
  const value = displayValue(card);
  const interactive = Boolean(card.drillHref) || Boolean(onDrill);
  const tone = statTone(card);

  const Icon = metricIcon(card.key);

  const inner = (
    <div
      className={cn(
        'group flex h-full flex-col gap-4 rounded-lg border bg-surface p-4 transition-colors',
        TONE_BORDER[tone],
        interactive && 'hover:border-border-brand hover:bg-surface-2',
      )}
    >
      {/* Topo: ícone + seta de drill */}
      <div className="flex items-center justify-between">
        <span className="flex size-7 items-center justify-center rounded-md bg-surface-3 text-text-low">
          <Icon size={14} />
        </span>
        {interactive && (
          <ArrowUpRight
            size={14}
            className="text-text-low opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
      </div>
      {/* Valor + label */}
      <div className="flex flex-col gap-0.5">
        <span className={cn('font-price text-2xl leading-none', TONE_VALUE[tone])}>{value}</span>
        <span className="font-body text-xs text-text-low">{card.label}</span>
      </div>
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
