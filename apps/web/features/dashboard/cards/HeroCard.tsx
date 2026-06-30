'use client';

/**
 * HeroCard — KPI grande do strip do topo (Dashboard v3 / F55-S06). Padrão Stripe:
 * **número grande legível + nome claro + legenda de contexto**, nunca um número
 * órfão (UX §2.4). Decompõe o `value` em principal (manchete) e secundário (sub-linha)
 * via `formatMetricDisplay` — fonte única de formatação — e acrescenta a legenda
 * editorial de `metricContext` ("o que esse número significa").
 *
 * Acento neon: UM único card por tela recebe `accent` (regra DS "1 verde por tela") —
 * borda `border-brand` + `shadow-glow-md` + chip do ícone em brand. Os demais ficam
 * sóbrios (surface-2, elevação leve). Tokens DS, zero hex.
 *
 * Drill: `onDrill` (drawer/sheet, §2.3 — nunca modal) tem prioridade; senão `drillHref`
 * navega (Link). Ação primária = clique no corpo (UX §2.1).
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
import { formatMetricDisplay, metricContext } from '../format';

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

interface HeroCardProps {
  card: DashboardCard;
  /** Único card da tela com acento neon (regra DS "1 verde por tela"). */
  accent?: boolean;
  onDrill?: (card: DashboardCard) => void;
}

export function HeroCard({ card, accent = false, onDrill }: HeroCardProps): React.JSX.Element {
  const { primary, secondary } = formatMetricDisplay(card.key, card.value);
  const caption = metricContext(card.key);
  const interactive = Boolean(card.drillHref) || Boolean(onDrill);
  const Icon = metricIcon(card.key);

  const inner = (
    <div
      className={cn(
        'group flex h-full flex-col justify-between gap-6 rounded-xl border p-5 transition-colors sm:p-6',
        accent ? 'border-brand bg-surface-2 shadow-glow-md' : 'border-border bg-surface-2 shadow-sm',
        interactive &&
          (accent ? 'hover:border-brand' : 'hover:border-border-brand hover:bg-surface-3'),
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

      {/* Número grande + secundário (contexto numérico) + nome + legenda editorial. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <span className="font-price text-3xl leading-none text-text sm:text-4xl">{primary}</span>
          {secondary && (
            <span className="font-price text-sm leading-none text-text-low">{secondary}</span>
          )}
        </div>
        <span className="font-head text-sm font-medium text-text-mid">{card.label}</span>
        {caption && <span className="font-body text-xs text-text-low">{caption}</span>}
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
