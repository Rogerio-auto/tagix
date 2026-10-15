'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Check, Clock, User } from 'lucide-react';
import { useToast } from '@hm/ui';
import { Sheet } from '@/shared/components/Sheet';
import { cn } from '@/shared/lib/cn';
import { formatMoney, stageAge } from './format';
import { isTransitionBlocked as transitionBlocked, transitionBlockedReason } from './stageMove';
import type { Deal, Stage } from './types';

export interface MobileBoardProps {
  stages: Stage[];
  dealsByStage: Map<string, Deal[]>;
  /** Abre o detalhe do deal (sheet). Ação primária do card (§2.1). */
  onOpenDeal: (dealId: string) => void;
  /** Move o deal para o stage destino. Reúsa a mutation existente. */
  onMoveDeal: (dealId: string, toStageId: string) => void;
  /** Relógio do board (ms) — base do "tempo na etapa". */
  nowMs: number;
  /** Trial vencido: a ação de mover fica indisponível. */
  readOnly?: boolean;
}


/**
 * Board do pipeline no mobile (MOBILE_UX §2 "Kanban"): seletor de estágio rolável
 * (chips com contagem) + lista vertical de cards do estágio ativo. O kanban
 * horizontal com drag (desktop) é inviável no toque — aqui mover é **ação
 * explícita** ("Mover para…" em bottom-sheet), evitando o anti-padrão
 * drag-arrasta-tudo no toque (§2.2). Tocar o card abre o detalhe (§2.1).
 */
export function MobileBoard({
  stages,
  dealsByStage,
  onOpenDeal,
  onMoveDeal,
  nowMs,
  readOnly = false,
}: MobileBoardProps): React.JSX.Element {
  const { toast } = useToast();
  const [activeStageId, setActiveStageId] = useState<string | null>(stages[0]?.id ?? null);
  // Deal alvo do sheet "Mover para…" (null = fechado).
  const [movingDeal, setMovingDeal] = useState<Deal | null>(null);

  // Mantém um estágio válido selecionado quando os stages chegam/mudam.
  useEffect(() => {
    if (stages.length === 0) {
      setActiveStageId(null);
      return;
    }
    setActiveStageId((current) =>
      current && stages.some((s) => s.id === current) ? current : (stages[0]?.id ?? null),
    );
  }, [stages]);

  const activeDeals = useMemo(
    () => (activeStageId ? (dealsByStage.get(activeStageId) ?? []) : []),
    [activeStageId, dealsByStage],
  );
  const activeStage = stages.find((s) => s.id === activeStageId) ?? null;

  function handleMove(toStageId: string): void {
    const deal = movingDeal;
    if (!deal) return;
    const to = stages.find((s) => s.id === toStageId);
    if (!to || deal.stageId === toStageId) {
      setMovingDeal(null);
      return;
    }
    const blocked = transitionBlockedReason(stages, deal, toStageId);
    if (blocked) {
      toast({ variant: 'warn', title: blocked });
      return;
    }
    onMoveDeal(deal.id, toStageId);
    setMovingDeal(null);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Seletor de estágio rolável (chips com contagem). */}
      <div
        role="tablist"
        aria-label="Estágios da pipeline"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-3"
      >
        {stages.map((stage) => {
          const count = dealsByStage.get(stage.id)?.length ?? 0;
          const isActive = stage.id === activeStageId;
          return (
            <button
              key={stage.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveStageId(stage.id)}
              className={cn(
                'touch-target flex shrink-0 items-center gap-2 rounded-pill border px-4 font-body text-sm font-bold outline-none transition-colors duration-(--dur-fast) focus-visible:focus-ring',
                isActive
                  ? 'border-border-brand bg-surface-2 text-text'
                  : 'border-border bg-surface text-text-mid hover:text-text',
              )}
            >
              <span className="size-2 rounded-pill" style={{ backgroundColor: stage.color }} aria-hidden />
              <span className="whitespace-nowrap">{stage.name}</span>
              <span
                className={cn(
                  'font-mono text-xs font-semibold tabular-nums',
                  isActive ? 'text-brand-text' : 'text-text-low',
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Lista vertical dos deals do estágio ativo. */}
      <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-safe-4">
        {activeDeals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-2 px-2 py-12 text-center font-body text-sm text-text-low">
            Nenhum negócio em {activeStage?.name ?? 'este estágio'}.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {activeDeals.map((deal) => {
              const age = stageAge(deal, nowMs);
              return (
                <li key={deal.id}>
                  <div className="flex items-stretch rounded-md border border-border bg-surface transition-colors hover:border-border-brand">
                    {/* Corpo do card = ação primária (abrir detalhe, §2.1). */}
                    <button
                      type="button"
                      onClick={() => onOpenDeal(deal.id)}
                      className="flex min-w-0 flex-1 flex-col gap-2 rounded-l-md p-3 text-left outline-none focus-visible:focus-ring -outline-offset-2"
                    >
                      <p className="line-clamp-2 font-body text-sm font-bold leading-snug text-text">
                        {deal.title}
                      </p>
                      <span className="flex items-end justify-between gap-2">
                        {deal.valueCents > 0 ? (
                          <span className="font-mono text-sm font-semibold tabular-nums text-brand-text">
                            {formatMoney(deal.valueCents, deal.currency)}
                          </span>
                        ) : (
                          <span />
                        )}
                        {age ? (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 font-mono text-xs tabular-nums',
                              age.stale ? 'text-warn' : 'text-text-low',
                            )}
                          >
                            <Clock className="size-3" aria-hidden />
                            <span aria-hidden>{age.short}</span>
                            <span className="sr-only">na etapa há {age.long}</span>
                          </span>
                        ) : null}
                      </span>
                      {deal.ownerId ? (
                        <span className="flex items-center gap-1 font-body text-xs text-text-low">
                          <User className="size-3" aria-hidden />
                          Responsável atribuído
                        </span>
                      ) : null}
                    </button>
                    {/* Ação explícita de mover (equivalente por toque do drag, §2.2). */}
                    <button
                      type="button"
                      onClick={() => setMovingDeal(deal)}
                      disabled={readOnly}
                      aria-label={`Mover "${deal.title}" para outro estágio`}
                      className="touch-target grid shrink-0 place-items-center rounded-r-md border-l border-border px-3 text-text-low outline-none transition-colors hover:text-text focus-visible:focus-ring -outline-offset-2 disabled:opacity-40"
                    >
                      <ArrowRightLeft className="size-4" aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Sheet "Mover para…" — lista de estágios destino. */}
      <Sheet
        open={movingDeal !== null}
        onClose={() => setMovingDeal(null)}
        variant="bottom"
        title="Mover para"
      >
        {movingDeal ? (
          <p className="-mt-2 mb-3 line-clamp-1 font-body text-sm text-text-mid">{movingDeal.title}</p>
        ) : null}
        <ul className="flex flex-col gap-1 pb-2">
          {stages.map((stage) => {
            const isCurrent = movingDeal?.stageId === stage.id;
            const blocked = movingDeal ? transitionBlocked(stage, movingDeal.stageId) : false;
            return (
              <li key={stage.id}>
                <button
                  type="button"
                  onClick={() => handleMove(stage.id)}
                  disabled={isCurrent || blocked}
                  className={cn(
                    'touch-target flex w-full items-center gap-3 rounded-md px-3 text-left font-body text-sm outline-none transition-colors focus-visible:focus-ring -outline-offset-2',
                    isCurrent
                      ? 'cursor-default text-text-low'
                      : blocked
                        ? 'cursor-not-allowed text-text-low opacity-60'
                        : 'text-text hover:bg-surface-2',
                  )}
                >
                  <span className="size-2 shrink-0 rounded-pill" style={{ backgroundColor: stage.color }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{stage.name}</span>
                  {isCurrent ? (
                    <span className="flex items-center gap-1 text-xs text-text-low">
                      <Check className="size-4" aria-hidden /> Atual
                    </span>
                  ) : blocked ? (
                    <span className="text-xs text-text-low">Bloqueado</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </div>
  );
}
