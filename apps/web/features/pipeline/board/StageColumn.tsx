'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { cn } from '@/shared/lib/cn';
import { DealCard } from './DealCard';
import type { Deal, Stage } from './types';

export interface StageColumnProps {
  stage: Stage;
  deals: Deal[];
  onOpenDeal?: (dealId: string) => void;
}

/** Coluna do kanban: um stage com seus deals (droppable + sortable). F5-S09. */
export function StageColumn({ stage, deals, onOpenDeal }: StageColumnProps): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, data: { stageId: stage.id } });

  return (
    <div className="flex w-72 shrink-0 flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden />
          <h3 className="text-sm font-semibold text-text">{stage.name}</h3>
        </div>
        <span className="rounded-full bg-surface-raised px-2 py-0.5 text-xs text-text-low">
          {deals.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-24 flex-col gap-2 rounded-lg border border-transparent p-1 transition',
          isOver && 'border-accent bg-surface-raised/40',
        )}
      >
        <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
          {deals.map((deal) => (
            <DealCard key={deal.id} deal={deal} onOpen={onOpenDeal} />
          ))}
        </SortableContext>
        {deals.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-text-low">Sem negócios</p>
        ) : null}
      </div>
    </div>
  );
}
