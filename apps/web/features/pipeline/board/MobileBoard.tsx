'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Check, User } from 'lucide-react';
import { useToast } from '@hm/ui';
import { Sheet } from '@/shared/components/Sheet';
import { cn } from '@/shared/lib/cn';
import type { Deal, Stage } from './types';

export interface MobileBoardProps {
  stages: Stage[];
  dealsByStage: Map<string, Deal[]>;
  /** Abre o detalhe do deal (sheet). Ação primária do card (§2.1). */
  onOpenDeal: (dealId: string) => void;
  /** Move o deal para o stage destino. Reúsa a mutation existente. */
  onMoveDeal: (dealId: string, toStageId: string) => void;
}

function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

/** Espelho client-side de `transitionRules.allowedFromStageIds` (§4.2). A checagem
 * completa é server-side e autoritativa; aqui só desabilitamos o óbvio. */
function transitionBlocked(to: Stage, fromStageId: string): boolean {
  const allowed = to.transitionRules?.allowedFromStageIds ?? [];
  return allowed.length > 0 && !allowed.includes(fromStageId);
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
    if (transitionBlocked(to, deal.stageId)) {
      toast({ variant: 'warn', title: `Não é permitido mover para "${to.name}" a partir do estágio atual.` });
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
        className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-3"
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
                'touch-target flex shrink-0 items-center gap-2 rounded-pill border px-4 text-sm font-medium outline-none transition-colors duration-150 focus-visible:shadow-glow-md',
                isActive
                  ? 'border-accent bg-surface-raised text-text'
                  : 'border-border bg-surface text-text-mid hover:text-text',
              )}
            >
              <span className="size-2.5 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden />
              <span className="whitespace-nowrap">{stage.name}</span>
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs',
                  isActive ? 'bg-accent/15 text-text' : 'bg-surface-raised text-text-low',
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Lista vertical dos deals do estágio ativo. */}
      <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6 pb-safe-4">
        {activeDeals.length === 0 ? (
          <p className="px-2 py-12 text-center text-sm text-text-low">
            Nenhum negócio em {activeStage?.name ?? 'este estágio'}.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {activeDeals.map((deal) => (
              <li key={deal.id}>
                <div className="flex items-stretch gap-2 rounded-lg border border-border bg-surface transition-colors hover:border-border-strong">
                  {/* Corpo do card = ação primária (abrir detalhe, §2.1). */}
                  <button
                    type="button"
                    onClick={() => onOpenDeal(deal.id)}
                    className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-l-lg p-3 text-left outline-none focus-visible:shadow-glow-md"
                  >
                    <p className="line-clamp-2 text-sm font-medium text-text">{deal.title}</p>
                    {deal.valueCents > 0 ? (
                      <p className="text-xs text-text-mid">{formatBRL(deal.valueCents)}</p>
                    ) : null}
                    {deal.ownerId ? (
                      <p className="flex items-center gap-1 text-xs text-text-low">
                        <User className="size-3" aria-hidden />
                        Responsável atribuído
                      </p>
                    ) : null}
                  </button>
                  {/* Ação explícita de mover (equivalente por toque do drag, §2.2). */}
                  <button
                    type="button"
                    onClick={() => setMovingDeal(deal)}
                    aria-label={`Mover "${deal.title}" para outro estágio`}
                    className="touch-target grid shrink-0 place-items-center rounded-r-lg border-l border-border-subtle px-3 text-text-low outline-none transition-colors hover:text-text focus-visible:shadow-glow-md"
                  >
                    <ArrowRightLeft className="size-4" />
                  </button>
                </div>
              </li>
            ))}
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
          <p className="-mt-2 mb-3 line-clamp-1 text-sm text-text-mid">{movingDeal.title}</p>
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
                    'touch-target flex w-full items-center gap-3 rounded-md px-3 text-left text-sm outline-none transition-colors focus-visible:shadow-glow-md',
                    isCurrent
                      ? 'cursor-default text-text-low'
                      : blocked
                        ? 'cursor-not-allowed text-text-low opacity-60'
                        : 'text-text hover:bg-surface-raised',
                  )}
                >
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden />
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
