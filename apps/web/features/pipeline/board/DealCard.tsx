'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardBody } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import type { Deal } from './types';

export interface DealCardProps {
  deal: Deal;
  onOpen?: (dealId: string) => void;
}

function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

/** Card arrastável do kanban (F5-S09, PIPELINE.md §9.2). dnd-kit sortable. */
export function DealCard({ deal, onOpen }: DealCardProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    data: { stageId: deal.stageId },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn('cursor-grab touch-none', isDragging && 'opacity-50')}
      onClick={() => onOpen?.(deal.id)}
    >
      <Card elevation={1} className="hover:border-border-strong">
        <CardBody className="flex flex-col gap-1.5 p-3">
          <p className="line-clamp-2 text-sm font-medium text-text">{deal.title}</p>
          {deal.valueCents > 0 ? (
            <p className="text-xs text-text-mid">{formatBRL(deal.valueCents)}</p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
