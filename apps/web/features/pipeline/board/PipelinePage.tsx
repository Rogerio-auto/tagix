'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { Button, useToast } from '@hm/ui';
import { HelpHint } from '@/shared/components/help';
import { StageColumn } from './StageColumn';
import { useDeals, usePipelineDetail, usePipelines, useMoveDeal } from './queries';
import { DealDetailDrawer } from '../deal';
import type { CustomFieldDef } from '../custom-fields';
import { useDealSocket } from './useDealSocket';
import { CreatePipelineModal } from '../settings/CreatePipelineModal';
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
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const pipelines = pipelinesQuery.data?.data ?? [];
  const meta = pipelinesQuery.data?.meta;
  const pipelineId = selectedId ?? pipelines[0]?.id;

  const detail = usePipelineDetail(pipelineId);
  const dealsQuery = useDeals(pipelineId);
  const move = useMoveDeal(pipelineId ?? '');
  useDealSocket(pipelineId);

  // Paridade teclado↔mouse (UX §2.10): KeyboardSensor permite pegar (Espaço),
  // mover (setas) e soltar (Espaço) um deal entre stages sem mouse. PointerSensor
  // mantém o drag por mouse intacto (sem regressão).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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

  const dealTitle = (id: string | number): string =>
    deals.find((d) => d.id === String(id))?.title ?? 'negócio';
  const stageName = (data: { stageId?: string } | undefined, fallbackId?: string | number): string => {
    const sid = data?.stageId ?? (fallbackId != null ? String(fallbackId) : undefined);
    return stages.find((s) => s.id === sid)?.name ?? 'etapa';
  };

  // Anúncios aria-live do drag por teclado (acessibilidade do dnd — UX §2.10):
  // o usuário ouve o que pegou, sobre qual etapa está e onde soltou.
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Negócio "${dealTitle(active.id)}" selecionado. Use as setas para mover entre etapas e Espaço para soltar.`,
    onDragOver: ({ active, over }) => {
      if (!over) return undefined;
      const overData = over.data.current as { stageId?: string } | undefined;
      return `"${dealTitle(active.id)}" sobre a etapa "${stageName(overData, over.id)}".`;
    },
    onDragEnd: ({ active, over }) => {
      if (!over) return `Movimentação de "${dealTitle(active.id)}" cancelada.`;
      const overData = over.data.current as { stageId?: string } | undefined;
      return `"${dealTitle(active.id)}" movido para a etapa "${stageName(overData, over.id)}".`;
    },
    onDragCancel: ({ active }) =>
      `Movimentação de "${dealTitle(active.id)}" cancelada; permanece na etapa atual.`,
  };

  if (pipelinesQuery.isLoading) {
    return <div className="p-6 text-sm text-text-mid">Carregando pipeline…</div>;
  }
  if (pipelines.length === 0) {
    return (
      <>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-surface-raised">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-6 text-text-low" aria-hidden>
                <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
                <path d="M7 7h.01" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-text">Nenhuma pipeline criada ainda</h2>
            <p className="text-sm text-text-mid">
              Crie sua primeira pipeline de vendas para comecar a organizar seus deals.
            </p>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="size-4" />
              Criar pipeline
            </Button>
          </div>
        </div>
        <CreatePipelineModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={(newId) => {
            setShowCreate(false);
            setSelectedId(newId);
          }}
        />
      </>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
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
          {meta && pipelines.length >= 2 && (
            <span className="text-xs text-text-low">
              {meta.current} / {meta.limit} pipelines
            </span>
          )}
          <HelpHint k="pipeline.board" />
        </div>
        <Button
          variant="secondary"
          onClick={() => setShowCreate(true)}
          disabled={meta ? meta.current >= meta.limit : false}
          title={meta && meta.current >= meta.limit ? "Limite de " + meta.limit + " pipelines atingido. Exclua uma para criar outra." : undefined}
        >
          <Plus className="size-4" />
          Nova pipeline
        </Button>
      </header>

      {detail.isLoading ? (
        <div className="flex gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-64 w-72 animate-pulse rounded-lg bg-surface-raised" />
          ))}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragEnd={onDragEnd}
          accessibility={{ announcements }}
        >
          <div className="flex flex-1 gap-4 overflow-x-auto pb-4">
            {stages.map((stage) => (
              <StageColumn
                key={stage.id}
                stage={stage}
                deals={dealsByStage.get(stage.id) ?? []}
                onOpenDeal={setOpenDealId}
              />
            ))}
          </div>
        </DndContext>
      )}

      <CreatePipelineModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(newId) => {
          setShowCreate(false);
          setSelectedId(newId);
        }}
      />

      <DealDetailDrawer
        dealId={openDealId}
        canEdit
        customFieldDefs={(detail.data?.pipeline.settings.custom_fields as CustomFieldDef[] | undefined) ?? []}
        onClose={() => setOpenDealId(null)}
      />
    </div>
  );
}
