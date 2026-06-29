'use client';

/**
 * Placar IA × Humano (F55-S07 / DASHBOARD §2.4). Comparativo lado a lado das
 * conversões e da receita do mês **atribuídas à IA** vs **atribuídas à equipe**.
 * O servidor (S05) entrega `cardType: 'scoreboard'` com o shape `{ ia, humano }`
 * (cada lado `{ count, valueCents }`). O card comunica o líder de relance (UX §2.4):
 * a coluna vencedora ganha elevação + pílula "Líder" + número no tom do seu time;
 * a perdedora fica sóbria. Uma barra de proporção fecha a leitura ("quem trouxe
 * mais receita").
 *
 * Paleta: IA = `info` (azul, tom de "robô/tecnologia"); equipe = neutro forte. O verde
 * neon (`brand`) NÃO aparece aqui — segue reservado ao KPI primário (regra DS "1 verde
 * por tela"). a11y: cada lado tem rótulo textual além da cor; a barra tem `role=img`
 * com aria-label. Tokens DS, zero hex.
 *
 * Drill: `onDrill` (drawer, §2.3) tem prioridade; senão `drillHref` navega (`/conversions`).
 * Ação primária = clique no corpo (UX §2.1).
 */
import Link from 'next/link';
import { ArrowUpRight, Bot, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import type { DashboardCard, MetricValue } from '../types';
import { formatBRLFromCents, formatInt, formatPercent } from '../format';

interface Placar {
  readonly ia: { readonly count: number; readonly valueCents: number };
  readonly humano: { readonly count: number; readonly valueCents: number };
}

function readSide(raw: unknown): { count: number; valueCents: number } {
  if (typeof raw !== 'object' || raw === null) return { count: 0, valueCents: 0 };
  const o = raw as Record<string, unknown>;
  const count = typeof o['count'] === 'number' && Number.isFinite(o['count']) ? o['count'] : 0;
  const valueCents =
    typeof o['valueCents'] === 'number' && Number.isFinite(o['valueCents']) ? o['valueCents'] : 0;
  return { count, valueCents };
}

/** Lê com segurança o shape `{ ia, humano }` do value jsonb; null se ausente. */
export function readPlacar(value: MetricValue | null): Placar | null {
  if (!value) return null;
  return { ia: readSide(value['ia']), humano: readSide(value['humano']) };
}

/** Lado vencedor por conversões (desempate por receita). `null` = empate técnico. */
type Leader = 'ia' | 'humano' | null;

function computeLeader(p: Placar): Leader {
  if (p.ia.count !== p.humano.count) return p.ia.count > p.humano.count ? 'ia' : 'humano';
  if (p.ia.valueCents !== p.humano.valueCents) {
    return p.ia.valueCents > p.humano.valueCents ? 'ia' : 'humano';
  }
  return null;
}

interface SideConfig {
  readonly side: 'ia' | 'humano';
  readonly label: string;
  readonly icon: LucideIcon;
  readonly chipClass: string;
  readonly leaderNumberClass: string;
  readonly barClass: string;
}

const SIDES: readonly SideConfig[] = [
  {
    side: 'ia',
    label: 'Atribuído à IA',
    icon: Bot,
    chipClass: 'bg-info/10 text-info',
    leaderNumberClass: 'text-info',
    barClass: 'bg-info',
  },
  {
    side: 'humano',
    label: 'Atribuído à equipe',
    icon: Users,
    chipClass: 'bg-surface-3 text-text-mid',
    leaderNumberClass: 'text-text',
    barClass: 'bg-text-mid',
  },
];

interface PlacarIaHumanoCardProps {
  card: DashboardCard;
  onDrill?: (card: DashboardCard) => void;
}

function SideColumn({
  cfg,
  data,
  isLeader,
}: {
  cfg: SideConfig;
  data: { count: number; valueCents: number };
  isLeader: boolean;
}): React.JSX.Element {
  const Icon = cfg.icon;
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-4 transition-colors',
        isLeader ? 'border-border-2 bg-surface-2' : 'border-border bg-surface',
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn('flex size-7 items-center justify-center rounded-md', cfg.chipClass)}
        >
          <Icon size={14} />
        </span>
        {isLeader && (
          <span className="rounded-pill bg-surface-3 px-2 py-0.5 font-body text-[0.625rem] font-medium uppercase tracking-wide text-text-mid">
            Líder
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span
          className={cn(
            'font-price text-2xl leading-none',
            isLeader ? cfg.leaderNumberClass : 'text-text-mid',
          )}
        >
          {formatInt(data.count)}
        </span>
        <span className="font-body text-[0.6875rem] text-text-low">{cfg.label}</span>
        <span className="font-price text-xs text-text-mid">{formatBRLFromCents(data.valueCents)}</span>
      </div>
    </div>
  );
}

export function PlacarIaHumanoCard({ card, onDrill }: PlacarIaHumanoCardProps): React.JSX.Element {
  const placar = readPlacar(card.value);
  const interactive = Boolean(card.drillHref) || Boolean(onDrill);

  const empty =
    !placar ||
    (placar.ia.count === 0 &&
      placar.humano.count === 0 &&
      placar.ia.valueCents === 0 &&
      placar.humano.valueCents === 0);

  const inner = (
    <div
      className={cn(
        'group flex h-full flex-col gap-4 rounded-lg border border-border bg-surface p-4 transition-colors sm:p-5',
        interactive && 'hover:border-border-brand',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-head text-sm font-medium text-text">{card.label}</span>
        {interactive && (
          <ArrowUpRight
            size={14}
            className="text-text-low opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
      </div>

      {empty || !placar ? (
        <p className="font-body text-sm text-text-low">
          Nenhuma conversão atribuída neste mês. O placar aparece assim que houver
          conversões registradas.
        </p>
      ) : (
        <PlacarBody placar={placar} />
      )}
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

function PlacarBody({ placar }: { placar: Placar }): React.JSX.Element {
  const leader = computeLeader(placar);

  // Proporção pela receita (a régua de dinheiro); cai para contagem quando ainda não
  // há receita atribuída — nunca uma barra vazia enganosa.
  const byValue = placar.ia.valueCents + placar.humano.valueCents > 0;
  const iaWeight = byValue ? placar.ia.valueCents : placar.ia.count;
  const humanWeight = byValue ? placar.humano.valueCents : placar.humano.count;
  const totalWeight = Math.max(1, iaWeight + humanWeight);
  const iaPct = Math.round((iaWeight / totalWeight) * 100);
  const humanPct = 100 - iaPct;

  const [iaCfg, humanCfg] = SIDES;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {iaCfg && (
          <SideColumn cfg={iaCfg} data={placar.ia} isLeader={leader === 'ia'} />
        )}
        {humanCfg && (
          <SideColumn cfg={humanCfg} data={placar.humano} isLeader={leader === 'humano'} />
        )}
      </div>

      {/* Barra de proporção (quem trouxe mais — por receita, ou contagem se sem receita). */}
      <div className="flex flex-col gap-2">
        <div
          role="img"
          aria-label={`IA ${iaPct}%, equipe ${humanPct}%`}
          className="flex h-2 w-full overflow-hidden rounded-pill bg-surface-2"
        >
          {iaWeight > 0 && (
            <div className={cn('h-full', iaCfg?.barClass)} style={{ width: `${iaPct}%` }} />
          )}
          {humanWeight > 0 && (
            <div className={cn('h-full', humanCfg?.barClass)} style={{ width: `${humanPct}%` }} />
          )}
        </div>
        <div className="flex items-center justify-between font-body text-[0.6875rem] text-text-mid">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-pill bg-info" aria-hidden="true" />
            IA {formatPercent(iaPct)}
          </span>
          <span className="flex items-center gap-1.5">
            Equipe {formatPercent(humanPct)}
            <span className="h-2 w-2 rounded-pill bg-text-mid" aria-hidden="true" />
          </span>
        </div>
      </div>
    </>
  );
}
