'use client';

import { useEffect, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { Card } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { useReorderManualFlows } from './queries';
import type { Flow, ManualOrderItem } from './types';

function SortableRow({ flow }: { flow: Flow }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: flow.id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-3 px-4 py-3',
        isDragging && 'bg-surface-3 opacity-80 shadow-lg',
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-text-low hover:text-text active:cursor-grabbing"
        aria-label="Reordenar"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="truncate font-head text-sm text-text">{flow.name}</span>
    </li>
  );
}

/**
 * Reordenacao drag-and-drop dos flows `manual` (FX-029a). Persiste `manual_position` via
 * PATCH /api/flows/manual-order. Feedback de drag suave (sem overlap de texto — anti-padrao
 * do v1 evitado: o item arrastado mantem layout e so ganha sombra/opacidade).
 */
export function ManualFlowsReorder({ flows }: { flows: Flow[] }) {
  const [order, setOrder] = useState<Flow[]>(flows);
  const reorder = useReorderManualFlows();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    setOrder(flows);
  }, [flows]);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.findIndex((f) => f.id === active.id);
    const newIndex = order.findIndex((f) => f.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    const payload: ManualOrderItem[] = next.map((f, i) => ({ id: f.id, manualPosition: i }));
    reorder.mutate(payload);
  };

  if (flows.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="font-head text-sm font-semibold text-text-low">Flows manuais (ordem)</h2>
      <Card elevation={1}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <ul className="divide-y divide-border-2">
              {order.map((flow) => (
                <SortableRow key={flow.id} flow={flow} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </Card>
    </section>
  );
}
