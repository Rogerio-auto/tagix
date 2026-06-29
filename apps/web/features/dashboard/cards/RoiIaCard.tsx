'use client';

/**
 * ROI da IA (F55-S07 / DASHBOARD §2.4). Quanto de receita atribuída à IA o mês gerou
 * para cada dólar gasto com IA. O servidor (S05) entrega `cardType: 'stat'` com o
 * shape `{ receitaCents, custoUsd, roi }` — `roi` é `null` quando o custo é 0.
 *
 * Clareza (UX §2.4 — sem número órfão): a manchete é o múltiplo ("3,2×") e a legenda
 * explica a conta ("R$ X receita ÷ US$ Y custo"). Quando `roi` é `null` (custo zero),
 * NÃO inventa múltiplo: mostra estado neutro ("—") e diz que ainda não há custo de IA
 * no mês — nunca um número enganoso.
 *
 * Sem acento neon: o número fica em tom neutro forte (`text`), preservando a regra DS
 * "1 verde por tela" para o KPI primário. Tokens DS, zero hex.
 *
 * Drill: `onDrill` (drawer, §2.3) tem prioridade; senão `drillHref` navega (`/settings/usage`).
 */
import Link from 'next/link';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import type { DashboardCard, MetricValue } from '../types';
import { formatBRLFromCents, formatUSD, readNumber } from '../format';

interface RoiValue {
  readonly receitaCents: number;
  readonly custoUsd: number;
  readonly roi: number | null;
}

/** Lê com segurança o shape `{ receitaCents, custoUsd, roi }`; `roi` null preservado. */
export function readRoi(value: MetricValue | null): RoiValue {
  const receitaCents = readNumber(value, 'receitaCents') ?? 0;
  const custoUsd = readNumber(value, 'custoUsd') ?? 0;
  const roi = readNumber(value, 'roi');
  return { receitaCents, custoUsd, roi };
}

/** Múltiplo pt-BR com 1–2 casas e sufixo "×": 3.2 → "3,2×". `null` → "—". */
export function formatRoi(roi: number | null): string {
  if (roi === null || !Number.isFinite(roi)) return '—';
  const n = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(roi);
  return `${n}×`;
}

interface RoiIaCardProps {
  card: DashboardCard;
  onDrill?: (card: DashboardCard) => void;
}

export function RoiIaCard({ card, onDrill }: RoiIaCardProps): React.JSX.Element {
  const { receitaCents, custoUsd, roi } = readRoi(card.value);
  const interactive = Boolean(card.drillHref) || Boolean(onDrill);
  const hasRoi = roi !== null;

  const caption = hasRoi
    ? `${formatBRLFromCents(receitaCents)} de receita ÷ ${formatUSD(custoUsd)} de custo`
    : 'Sem custo de IA registrado neste mês';

  const inner = (
    <div
      className={cn(
        'group flex h-full flex-col gap-4 rounded-lg border border-border bg-surface p-4 transition-colors',
        interactive && 'hover:border-border-brand hover:bg-surface-2',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex size-7 items-center justify-center rounded-md bg-surface-3 text-text-low">
          <Sparkles size={14} />
        </span>
        {interactive && (
          <ArrowUpRight
            size={14}
            className="text-text-low opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className={cn('font-price text-2xl leading-none', hasRoi ? 'text-text' : 'text-text-mid')}>
          {formatRoi(roi)}
        </span>
        <span className="font-body text-xs font-medium text-text-mid">{card.label}</span>
        <span className="font-body text-[0.6875rem] text-text-low">{caption}</span>
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
