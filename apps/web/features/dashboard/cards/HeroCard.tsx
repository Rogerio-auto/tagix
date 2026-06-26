'use client';

/**
 * HeroCard (F48-S08 / DASHBOARD §9) — variante GRANDE do `StatCard` para os KPIs de
 * destaque no topo do Command Center. Número em `font-price` ampliado, ícone e label.
 *
 * Acento neon: UM único card por tela pode receber `accent` (regra DS "1 verde por
 * tela") — borda `border-brand` + `shadow-glow-md` + chip do ícone em brand. Os demais
 * ficam sóbrios (`surface-2` + elevação leve). Tokens DS, zero hex.
 *
 * Drill: idêntico ao StatCard — `onDrill` (drawer, §2.3 — nunca modal) tem prioridade;
 * senão `drillHref` navega (Link).
 *
 * A lógica de formatação vem de `../format` (fonte única). O mapa `metricIcon` e o
 * `displayValue` são uma variante enxuta aqui porque `StatCard.tsx` está fora do
 * `files_allowed` deste slot (não pode ser editado para exportar) — a fonte de verdade
 * dos formatadores continua sendo `../format`.
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
import {
  formatBRLFromCents,
  formatDuration,
  formatInt,
  formatPercent,
  formatScore100,
  formatUSD,
  readNumber,
} from '../format';

/** Ícone semântico por metric_key (espelha a heurística do StatCard). */
function metricIcon(key: string): LucideIcon {
  if (/volume|inbound|outbound|mensagem|conversa|fila/.test(key)) return MessageSquare;
  if (/tempo|tme|tmr|duracao|latencia/.test(key)) return Clock;
  if (/conversao|conversoes/.test(key)) return TrendingUp;
  if (/satisfacao|csat|nps/.test(key)) return Star;
  if (/qualidade/.test(key)) return Award;
  if (/custo|token|cap_mensal/.test(key)) return Zap;
  if (/valor|receita|faturamento|cents|deal|pipeline/.test(key)) return DollarSign;
  if (/objecao/.test(key)) return Shield;
  if (/agente|ia/.test(key)) return Bot;
  if (/atendente|membro|equipe/.test(key)) return Users;
  return BarChart3;
}

/** Deriva o texto exibido do jsonb `value` por convenção de chave (vide StatCard). */
function displayValue(card: DashboardCard): string {
  const v = card.value;
  if (!v) return '—';
  if (card.key === 'qualidade_resposta_media') {
    return formatScore100(readNumber(v, 'value'));
  }
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

interface HeroCardProps {
  card: DashboardCard;
  /** Único card da tela com acento neon (regra DS "1 verde por tela"). */
  accent?: boolean;
  onDrill?: (card: DashboardCard) => void;
}

export function HeroCard({ card, accent = false, onDrill }: HeroCardProps): React.JSX.Element {
  const value = displayValue(card);
  const interactive = Boolean(card.drillHref) || Boolean(onDrill);
  const Icon = metricIcon(card.key);

  const inner = (
    <div
      className={cn(
        'group flex h-full flex-col justify-between gap-6 rounded-xl border p-5 transition-colors sm:p-6',
        accent
          ? 'border-brand bg-surface-2 shadow-glow-md'
          : 'border-border bg-surface-2 shadow-sm',
        interactive && (accent ? 'hover:border-brand' : 'hover:border-border-brand hover:bg-surface-3'),
      )}
    >
      {/* Topo: chip do ícone + seta de drill */}
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'flex size-9 items-center justify-center rounded-lg',
            accent ? 'bg-brand-faint text-brand' : 'bg-surface-3 text-text-low',
          )}
        >
          <Icon size={18} />
        </span>
        {interactive && (
          <ArrowUpRight
            size={16}
            className="text-text-low opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
      </div>
      {/* Valor (grande) + label */}
      <div className="flex flex-col gap-1">
        <span className="font-price text-3xl leading-none text-text sm:text-4xl">{value}</span>
        <span className="font-body text-sm text-text-low">{card.label}</span>
      </div>
    </div>
  );

  if (onDrill) {
    return (
      <button type="button" onClick={() => onDrill(card)} className="block h-full w-full text-left">
        {inner}
      </button>
    );
  }
  if (card.drillHref) {
    return (
      <Link href={card.drillHref} className="block h-full">
        {inner}
      </Link>
    );
  }
  return inner;
}
