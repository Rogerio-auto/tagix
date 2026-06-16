'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Card, CardBody, Input, useToast } from '@hm/ui';
import {
  usePipelineDetail,
  usePipelines,
  useUpdatePipeline,
  useDeletePipeline,
} from '../board/queries';
import type { Stage } from '../board/types';
import {
  useCreateStage,
  useDeleteStage,
  useReorderStages,
  useUpdateStage,
} from './queries';
import { CreatePipelineModal } from './CreatePipelineModal';
import { DeletePipelineDialog } from './DeletePipelineDialog';

/**
 * Settings do pipeline (F5-S09 + F35-S01): stages + CRUD de pipelines.
 * Cria/renomeia/deleta pipelines + gerencia estagios. DS v2: tokens semânticos.
 */
export function PipelineSettingsPage(): React.JSX.Element {
  const { toast } = useToast();
  const pipelinesQuery = usePipelines();
  const pipelines = pipelinesQuery.data?.data ?? [];
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const activeId = pipelineId ?? pipelines[0]?.id;
  const activePipeline = pipelines.find((p) => p.id === activeId);
  const detail = usePipelineDetail(activeId);

  const update = useUpdateStage(activeId ?? '');
  const reorder = useReorderStages(activeId ?? '');
  const create = useCreateStage(activeId ?? '');
  const remove = useDeleteStage(activeId ?? '');
  const updatePipeline = useUpdatePipeline();
  const deletePipeline = useDeletePipeline();

  const serverStages = useMemo(
    () => [...(detail.data?.stages ?? [])].sort((a, b) => a.position - b.position),
    [detail.data],
  );
  const [stages, setStages] = useState<Stage[]>([]);
  useEffect(() => setStages(serverStages), [serverStages]);

  const [newName, setNewName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  function startRename() {
    if (!activePipeline) return;
    setRenameValue(activePipeline.name);
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  }

  function commitRename() {
    const trimmed = renameValue.trim();
    if (!trimmed || !activeId || trimmed === activePipeline?.name) {
      setIsRenaming(false);
      return;
    }
    updatePipeline.mutate(
      { id: activeId, name: trimmed },
      {
        onError: (e) => toast({ variant: 'error', title: e.message }),
        onSettled: () => setIsRenaming(false),
      },
    );
  }

  function handleDeletePipeline() {
    if (!activeId) return;
    const remaining = pipelines.filter((p) => p.id !== activeId);
    deletePipeline.mutate(
      { id: activeId },
      {
        onError: (e) => toast({ variant: 'error', title: e.message }),
        onSuccess: () => {
          setShowDelete(false);
          const next = remaining[0];
          if (next) setPipelineId(next.id);
          else setPipelineId(null);
        },
      },
    );
  }

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
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                if (e.key === 'Escape') setIsRenaming(false);
              }}
              className="rounded-md border border-primary bg-surface px-2 py-1 text-base font-semibold text-text outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={startRename}
              title="Clique para renomear"
              className="group flex items-center gap-1.5 text-lg font-semibold text-text hover:text-primary"
            >
              {activePipeline?.name ?? 'Configurar pipeline'}
              <Pencil className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={activeId}
            onChange={(e) => setPipelineId(e.target.value)}
            aria-label="Selecionar pipeline"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
          >
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => setShowCreate(true)}>
            <Plus className="size-4" />
            Nova pipeline
          </Button>
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            disabled={pipelines.length <= 1}
            aria-label="Excluir pipeline"
            title={
              pipelines.length <= 1
                ? 'Nao e possivel excluir a unica pipeline'
                : 'Excluir pipeline'
            }
            className="rounded-md p-2 text-text-low transition-colors hover:text-danger disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
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

      <CreatePipelineModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(newId) => {
          setShowCreate(false);
          setPipelineId(newId);
        }}
      />

      {activePipeline && (
        <DeletePipelineDialog
          open={showDelete}
          pipelineName={activePipeline.name}
          onClose={() => setShowDelete(false)}
          onConfirm={handleDeletePipeline}
          isDeleting={deletePipeline.isPending}
        />
      )}
    </div>
  );
}

