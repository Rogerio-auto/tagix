'use client';

/**
 * Card de estatística secundária (Dashboard v3 / F55-S06 — os blocos numéricos fora do
 * strip de KPIs). Mesmo princípio de clareza do HeroCard, em escala menor: **número +
 * nome + legenda de contexto** (UX §2.4 — nunca número órfão). Formatação via
 * `formatMetricDisplay` (fonte única) e legenda via `metricContext`.
 *
 * Clicável quando tem drill: navega para a página filtrada (§4) OU, se o caller passar
 * `onDrill`, abre o drawer/sheet lateral. Modal full-screen é proibido (UX §2.3).
 * Sem dado → "—" (o card existe porque o server o enviou; o número ainda não computou).
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
import { formatMetricDisplay, metricContext, readNumber } from '../format';
import { CsatCard } from './CsatCard';

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

/**
 * Estado de alerta de um card stat. Hoje só `cap_mensal_consumido_pct`: ≥100% danger,
 * ≥80% warn, abaixo neutro. Mapeia para tokens DS (sem hex).
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
  const { primary, secondary } = formatMetricDisplay(card.key, card.value);
  const caption = metricContext(card.key);
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
      {/* Número + secundário + nome + legenda (clareza §2.4 — sem número órfão). */}
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-1.5">
          <span className={cn('font-price text-2xl leading-none', TONE_VALUE[tone])}>{primary}</span>
          {secondary && (
            <span className="font-price text-xs leading-none text-text-low">{secondary}</span>
          )}
        </div>
        <span className="font-body text-xs font-medium text-text-mid">{card.label}</span>
        {caption && <span className="font-body text-[0.6875rem] text-text-low">{caption}</span>}
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
