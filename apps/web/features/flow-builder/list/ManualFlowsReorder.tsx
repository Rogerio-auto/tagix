'use client';

import { useEffect, useId, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useToast } from '@hm/ui';
import { READ_ONLY_CLASS, READ_ONLY_TOOLTIP, readOnlyActionProps, useIsReadOnly } from '@/shared/components/account-banner';
import { ApiError } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/cn';
import { formatNumber } from '@/shared/lib/locale';
import { useReorderManualFlows } from './queries';
import type { Flow, ManualOrderItem } from './types';

function SortableRow({
  flow,
  position,
  readOnly,
  descriptionId,
}: {
  flow: Flow;
  position: number;
  readOnly: boolean;
  descriptionId: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: flow.id,
    disabled: readOnly,
  });
  // Só leitura: o puxador continua focável e explicado, mas sem arrastar nem teclado de reordenar.
  const guard = readOnlyActionProps<HTMLButtonElement>({ readOnly, descriptionId });
  return (
    <li
      ref={setNodeRef}
      // Transform do arrasto (geometria calculada pelo dnd-kit; nenhuma cor inline).
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-3 bg-surface px-3 py-2.5',
        isDragging && 'relative z-10 bg-surface-2 shadow-ds-3',
      )}
    >
      <button
        type="button"
        className={cn(
          'flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-text-low outline-none',
          'transition-colors hover:bg-surface-2 hover:text-text focus-visible:focus-ring active:cursor-grabbing',
          READ_ONLY_CLASS,
        )}
        aria-label={`Reordenar ${flow.name}`}
        {...(readOnly ? {} : attributes)}
        {...(readOnly ? {} : listeners)}
        {...guard}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="w-6 shrink-0 text-right font-mono text-xs tabular-nums text-text-low">
        {formatNumber(position)}
      </span>
      <span className="min-w-0 truncate text-sm font-medium text-text">{flow.name}</span>
    </li>
  );
}

/**
 * Reordenação dos flows `manual` (FX-029a) no DS 3.0 (F72-S07). A ordem é a da barra de
 * flows na conversa. Persiste `manual_position` via PATCH /api/flows/manual-order.
 *
 * Arrastar com o mouse/toque ou pelo teclado (Espaço pega, setas movem, Espaço solta;
 * UX §2.10). O item arrastado mantém o layout e só ganha sombra (sem sobrepor texto).
 * Falha ao salvar desfaz a ordem otimista e avisa (UX §2.7).
 * Só leitura (F71-S17): puxadores `aria-disabled` com a explicação, sem arrastar.
 */
export function ManualFlowsReorder({ flows }: { flows: Flow[] }) {
  const [order, setOrder] = useState<Flow[]>(flows);
  const reorder = useReorderManualFlows();
  const readOnly = useIsReadOnly();
  const { toast } = useToast();
  const descriptionId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    setOrder(flows);
  }, [flows]);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.findIndex((f) => f.id === active.id);
    const newIndex = order.findIndex((f) => f.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const previous = order;
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    const payload: ManualOrderItem[] = next.map((f, i) => ({ id: f.id, manualPosition: i }));
    reorder.mutate(payload, {
      onError: (err) => {
        setOrder(previous);
        toast({
          variant: 'error',
          title: 'Não foi possível salvar a ordem',
          description: err instanceof ApiError ? err.message : 'Tente novamente.',
        });
      },
    });
  };

  if (flows.length === 0) return null;

  return (
    <section aria-labelledby="manual-flows-title" className="space-y-3">
      <div>
        <h2 id="manual-flows-title" className="font-head text-base font-semibold text-text">
          Ordem dos flows manuais
        </h2>
        <p className="mt-1 text-sm text-text-low">
          É a ordem da barra de flows na conversa. Arraste, ou foque o puxador e use Espaço e as setas.
        </p>
      </div>
      {readOnly && (
        <p id={descriptionId} className="text-xs text-text-mid">
          {READ_ONLY_TOOLTIP}
        </p>
      )}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <ul className="divide-y divide-border">
              {order.map((flow, i) => (
                <SortableRow
                  key={flow.id}
                  flow={flow}
                  position={i + 1}
                  readOnly={readOnly}
                  descriptionId={descriptionId}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </div>
    </section>
  );
}
