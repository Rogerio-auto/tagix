'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Button, Card, CardBody, Input, useToast } from '@hm/ui';
import { usePipelineDetail, usePipelines } from '../board/queries';
import type { Stage } from '../board/types';
import {
  useCreateStage,
  useDeleteStage,
  useReorderStages,
  useUpdateStage,
} from './queries';

/**
 * Settings do pipeline (F5-S09, PIPELINE.md §9.4): editar/reordenar stages
 * (nome/cor), adicionar e remover (com realocação de deals via fallback). Gated
 * por `pipeline.edit` na navegação. DS v2: tokens, cor do stage é dado.
 */
export function PipelineSettingsPage(): React.JSX.Element {
  const { toast } = useToast();
  const pipelinesQuery = usePipelines();
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const activeId = pipelineId ?? pipelinesQuery.data?.pipelines[0]?.id;
  const detail = usePipelineDetail(activeId);

  const update = useUpdateStage(activeId ?? '');
  const reorder = useReorderStages(activeId ?? '');
  const create = useCreateStage(activeId ?? '');
  const remove = useDeleteStage(activeId ?? '');

  const serverStages = useMemo(
    () => [...(detail.data?.stages ?? [])].sort((a, b) => a.position - b.position),
    [detail.data],
  );
  const [stages, setStages] = useState<Stage[]>([]);
  useEffect(() => setStages(serverStages), [serverStages]);

  const [newName, setNewName] = useState('');

  function move(index: number, dir: -1 | 1): void {
    const target = index + dir;
    if (target < 0 || target >= stages.length) return;
    const next = [...stages];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    const repositioned = next.map((s, i) => ({ ...s, position: i }));
    setStages(repositioned);
    reorder.mutate(
      repositioned.map((s) => ({ id: s.id, position: s.position })),
      { onError: (e) => toast({ variant: 'error', title: e.message }) },
    );
  }

  function addStage(): void {
    const name = newName.trim();
    if (!name || !activeId) return;
    create.mutate(
      { name, position: stages.length },
      {
        onError: (e) => toast({ variant: 'error', title: e.message }),
        onSuccess: () => setNewName(''),
      },
    );
  }

  function deleteStage(stage: Stage): void {
    const fallback = stages.find((s) => s.id !== stage.id);
    remove.mutate(
      { id: stage.id, fallbackStageId: fallback?.id },
      {
        onError: (e) =>
          toast({
            variant: 'error',
            title: e.message || 'Não foi possível remover o estágio.',
          }),
      },
    );
  }

  if (pipelinesQuery.isLoading) {
    return <div className="p-6 text-sm text-text-mid">Carregando…</div>;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold text-text">Configurar pipeline</h1>
        <select
          value={activeId}
          onChange={(e) => setPipelineId(e.target.value)}
          aria-label="Selecionar pipeline"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
        >
          {(pipelinesQuery.data?.pipelines ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </header>

      <Card elevation={1}>
        <CardBody className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-text">Estágios</h2>
          {stages.map((stage, index) => (
            <div key={stage.id} className="flex items-center gap-2">
              <div className="flex flex-col">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label="Mover para cima"
                  className="text-text-low hover:text-text disabled:opacity-30"
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={index === stages.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label="Mover para baixo"
                  className="text-text-low hover:text-text disabled:opacity-30"
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>
              <input
                type="color"
                value={stage.color}
                aria-label="Cor do estágio"
                onChange={(e) =>
                  update.mutate({ id: stage.id, patch: { color: e.target.value } })
                }
                className="size-8 rounded border border-border bg-surface"
              />
              <Input
                value={stage.name}
                aria-label="Nome do estágio"
                onChange={(e) =>
                  setStages((prev) =>
                    prev.map((s) => (s.id === stage.id ? { ...s, name: e.target.value } : s)),
                  )
                }
                onBlur={(e) => update.mutate({ id: stage.id, patch: { name: e.target.value } })}
                className="flex-1"
              />
              <button
                type="button"
                onClick={() => deleteStage(stage)}
                aria-label="Remover estágio"
                className="text-text-low hover:text-danger"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}

          <div className="flex items-center gap-2 pt-2">
            <Input
              value={newName}
              placeholder="Novo estágio"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addStage();
                }
              }}
              className="flex-1"
            />
            <Button variant="secondary" disabled={!newName.trim()} onClick={addStage}>
              <Plus className="size-4" />
              Adicionar
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
