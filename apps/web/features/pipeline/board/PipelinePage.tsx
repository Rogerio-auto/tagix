'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useToast } from '@hm/ui';
import { StageColumn } from './StageColumn';
import { useDeals, usePipelineDetail, usePipelines, useMoveDeal } from './queries';
import { useDealSocket } from './useDealSocket';
import type { Deal, Stage } from './types';

/** Validação client-side de transition rule (espelho de §4.2): só checa
 * allowed_from (a checagem completa é server-side e autoritativa). */
function transitionBlocked(stages: Stage[], deal: Deal, toStageId: string): string | null {
  const to = stages.find((s) => s.id === toStageId);
  if (!to) return null;
  const allowed = to.transitionRules?.allowedFromStageIds ?? [];
  if (allowed.length > 0 && !allowed.includes(deal.stageId)) {
    return `Não é permitido mover para "${to.name}" a partir do estágio atual.`;
  }
  return null;
}

export function PipelinePage(): React.JSX.Element {
  const { toast } = useToast();
  const pipelinesQuery = usePipelines();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pipelines = pipelinesQuery.data?.pipelines ?? [];
  const pipelineId = selectedId ?? pipelines[0]?.id;

  const detail = usePipelineDetail(pipelineId);
  const dealsQuery = useDeals(pipelineId);
  const move = useMoveDeal(pipelineId ?? '');
  useDealSocket(pipelineId);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const stages = useMemo(
    () => [...(detail.data?.stages ?? [])].sort((a, b) => a.position - b.position),
    [detail.data],
  );
  const deals = dealsQuery.data?.deals ?? [];
  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const s of stages) map.set(s.id, []);
    for (const d of deals) {
      const arr = map.get(d.stageId);
      if (arr) arr.push(d);
    }
    return map;
  }, [stages, deals]);

  function onDragEnd(event: DragEndEvent): void {
    const dealId = String(event.active.id);
    const overData = event.over?.data.current as { stageId?: string } | undefined;
    const toStageId = overData?.stageId ?? (event.over ? String(event.over.id) : undefined);
    if (!toStageId) return;
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stageId === toStageId) return;

    const blocked = transitionBlocked(stages, deal, toStageId);
    if (blocked) {
      toast({ variant: 'warn', title: blocked });
      return;
    }
    move.mutate(
      { dealId, stageId: toStageId },
      {
        onError: (err) =>
          toast({ variant: 'error', title: err.message || 'Falha ao mover o negócio.' }),
      },
    );
  }

  if (pipelinesQuery.isLoading) {
    return <div className="p-6 text-sm text-text-mid">Carregando pipeline…</div>;
  }
  if (pipelines.length === 0) {
    return (
      <div className="p-6">
        <p className="text-sm text-text-mid">
          Nenhum pipeline ainda. Crie um a partir de um nicho no onboarding.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-4">
        <select
          value={pipelineId}
          onChange={(e) => setSelectedId(e.target.value)}
          aria-label="Selecionar pipeline"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-text"
        >
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </header>

      {detail.isLoading ? (
        <div className="flex gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-64 w-72 animate-pulse rounded-lg bg-surface-raised" />
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
          <div className="flex flex-1 gap-4 overflow-x-auto pb-4">
            {stages.map((stage) => (
              <StageColumn key={stage.id} stage={stage} deals={dealsByStage.get(stage.id) ?? []} />
            ))}
          </div>
        </DndContext>
      )}
    </div>
  );
}
