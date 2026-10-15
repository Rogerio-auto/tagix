'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '@/shared/lib/cn';
import { DealCard } from './DealCard';
import { formatTotals } from './format';
import type { MoveDirection } from './stageMove';
import type { Deal, Stage } from './types';

export interface StageColumnProps {
  stage: Stage;
  /** Todas as etapas do funil (destinos do menu "Mover para etapa"). */
  stages: readonly Stage[];
  deals: Deal[];
  onOpenDeal?: (dealId: string) => void;
  onMoveDeal?: (dealId: string, toStageId: string) => void;
  onMoveDealStep?: (dealId: string, dir: MoveDirection) => void;
  nowMs: number;
  disabled?: boolean;
  /** Deal recém-solto (assenta com animação curta). */
  settledDealId?: string | null;
}

/** Coluna do kanban: um stage com seus deals (droppable + sortable). F5-S09. */
export function StageColumn({
  stage,
  stages,
  deals,
  onOpenDeal,
  onMoveDeal,
  onMoveDealStep,
  nowMs,
  disabled = false,
  settledDealId = null,
}: StageColumnProps): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, data: { stageId: stage.id } });
  const total = formatTotals(deals);

  return (
    <section
      aria-label={stage.name}
      data-stage-id={stage.id}
      className="flex h-full min-h-0 w-72 shrink-0 flex-col gap-2 xl:w-80"
    >
      <header className="flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-pill"
            style={{ backgroundColor: stage.color }}
            aria-hidden
          />
          <h3 className="truncate font-mono text-xs font-semibold uppercase tracking-wider text-text-mid">
            {stage.name}
          </h3>
        </div>
        <span className="font-mono text-xs font-semibold tabular-nums text-text-low">
          {deals.length}
          <span className="sr-only">{deals.length === 1 ? ' negócio' : ' negócios'}</span>
        </span>
      </header>
      {total ? (
        <p className="-mt-1 px-1 font-mono text-xs tabular-nums text-text-low">{total}</p>
      ) : null}

      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain rounded-lg border bg-surface-inset p-2',
          'transition-[border-color,background-color] duration-(--dur-fast) ease-ds motion-reduce:transition-none',
          isOver ? 'border-border-brand bg-brand-text/5' : 'border-border',
        )}
      >
        <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
          {deals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              stages={stages}
              onOpen={onOpenDeal}
              onMove={onMoveDeal}
              onMoveStep={onMoveDealStep}
              nowMs={nowMs}
              disabled={disabled}
              settled={settledDealId === deal.id}
            />
          ))}
        </SortableContext>
        {deals.length === 0 ? (
          <p className="rounded-md border border-dashed border-border-2 px-2 py-6 text-center font-body text-xs text-text-low">
            Sem negócios
          </p>
        ) : null}
      </div>
    </section>
  );
}
