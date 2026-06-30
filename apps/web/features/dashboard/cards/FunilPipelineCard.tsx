'use client';

/**
 * Funil de pipeline (F55-S07 / DASHBOARD §3.2). Valor em aberto por estágio, como
 * barras horizontais ordenadas pela posição do estágio (o servidor — S05 — já entrega
 * as linhas ordenadas por `position`). Win rate e ciclo médio dos ganhos do mês entram
 * como contexto numérico, nunca como número órfão (UX §2.4).
 *
 * O shape de S05 é o contrato `table` estendido: além de `{ columns, rows }`, traz
 * `winRatePct | null`, `cicloMedioSegundos | null`, `fechadosMes`, `ganhosMes`. Cada
 * linha: `{ stageId, stage, abertos, valor_aberto_cents }`.
 *
 * Barras em `info` (azul) sobre trilho neutro — o verde neon segue reservado ao KPI
 * primário (regra DS "1 verde por tela"). Animação curta/proposital na largura da barra
 * (UX §3.10), respeitando `prefers-reduced-motion` (sem transição quando reduzido — o
 * Tailwind `transition-*` já é desligado pela media query global do projeto).
 *
 * Drill (UX §2.1/§2.3): clique no corpo abre o drawer quando o caller passa `onDrill`;
 * senão navega para `/pipeline` (drillHref). Nunca modal full-screen.
 */
import Link from 'next/link';
import { ArrowUpRight, Filter } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import type { DashboardCard, MetricValue } from '../types';
import { formatBRLFromCents, formatDuration, formatInt, formatPercent, readNumber } from '../format';

interface FunilStage {
  readonly stageId: string;
  readonly stage: string;
  readonly abertos: number;
  readonly valorAbertoCents: number;
}

interface FunilValue {
  readonly stages: FunilStage[];
  readonly winRatePct: number | null;
  readonly cicloMedioSegundos: number | null;
  readonly fechadosMes: number;
  readonly ganhosMes: number;
}

function readStage(raw: unknown): FunilStage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const stage = typeof o['stage'] === 'string' ? o['stage'] : null;
  if (stage === null) return null;
  const stageId = typeof o['stageId'] === 'string' ? o['stageId'] : stage;
  const abertos = typeof o['abertos'] === 'number' && Number.isFinite(o['abertos']) ? o['abertos'] : 0;
  const valorAbertoCents =
    typeof o['valor_aberto_cents'] === 'number' && Number.isFinite(o['valor_aberto_cents'])
      ? o['valor_aberto_cents']
      : 0;
  return { stageId, stage, abertos, valorAbertoCents };
}

/** Lê com segurança o contrato estendido do funil; rows ausentes → lista vazia. */
export function readFunil(value: MetricValue | null): FunilValue {
  const rawRows = value?.['rows'];
  const stages = Array.isArray(rawRows)
    ? rawRows.map(readStage).filter((s): s is FunilStage => s !== null)
    : [];
  return {
    stages,
    winRatePct: readNumber(value, 'winRatePct'),
    cicloMedioSegundos: readNumber(value, 'cicloMedioSegundos'),
    fechadosMes: readNumber(value, 'fechadosMes') ?? 0,
    ganhosMes: readNumber(value, 'ganhosMes') ?? 0,
  };
}

interface FunilPipelineCardProps {
  card: DashboardCard;
  onDrill?: (card: DashboardCard) => void;
}

function StageBar({ stage, max }: { stage: FunilStage; max: number }): React.JSX.Element {
  const pct = max > 0 ? Math.max(2, Math.round((stage.valorAbertoCents / max) * 100)) : 0;
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-body text-xs font-medium text-text-mid">{stage.stage}</span>
        <span className="shrink-0 font-price text-xs text-text">
          {formatBRLFromCents(stage.valorAbertoCents)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-2">
          {pct > 0 && (
            <div
              className="h-full rounded-pill bg-info transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          )}
        </div>
        <span className="w-14 shrink-0 text-right font-body text-[0.6875rem] text-text-low">
          {formatInt(stage.abertos)} {stage.abertos === 1 ? 'aberto' : 'abertos'}
        </span>
      </div>
    </li>
  );
}

function ContextRow({ funil }: { funil: FunilValue }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border-2 pt-3 font-body text-[0.6875rem] text-text-low">
      <span>
        Win rate{' '}
        <span className="font-price text-text-mid">
          {funil.winRatePct === null ? '—' : formatPercent(funil.winRatePct)}
        </span>
      </span>
      <span>
        Ciclo médio{' '}
        <span className="font-price text-text-mid">{formatDuration(funil.cicloMedioSegundos)}</span>
      </span>
      <span>
        Ganhos no mês{' '}
        <span className="font-price text-text-mid">
          {formatInt(funil.ganhosMes)} / {formatInt(funil.fechadosMes)}
        </span>
      </span>
    </div>
  );
}

export function FunilPipelineCard({ card, onDrill }: FunilPipelineCardProps): React.JSX.Element {
  const funil = readFunil(card.value);
  const interactive = Boolean(card.drillHref) || Boolean(onDrill);
  const maxValor = funil.stages.reduce((m, s) => Math.max(m, s.valorAbertoCents), 0);
  const totalAberto = funil.stages.reduce((sum, s) => sum + s.valorAbertoCents, 0);
  const empty = funil.stages.length === 0;

  const inner = (
    <div
      className={cn(
        'group flex h-full flex-col gap-4 rounded-lg border border-border bg-surface p-4 transition-colors sm:p-5',
        interactive && 'hover:border-border-brand',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-surface-3 text-text-low">
            <Filter size={14} />
          </span>
          <span className="font-head text-sm font-medium text-text">{card.label}</span>
        </div>
        {!empty ? (
          <span className="shrink-0 font-price text-sm text-text">
            {formatBRLFromCents(totalAberto)}
          </span>
        ) : (
          interactive && (
            <ArrowUpRight
              size={14}
              className="text-text-low opacity-0 transition-opacity group-hover:opacity-100"
            />
          )
        )}
      </div>

      {empty ? (
        <p className="font-body text-sm text-text-low">
          Nenhum estágio com negócios em aberto. Configure seu pipeline e o funil se
          desenha aqui.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5">
            {funil.stages.map((s) => (
              <StageBar key={s.stageId} stage={s} max={maxValor} />
            ))}
          </ul>
          <ContextRow funil={funil} />
        </>
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
