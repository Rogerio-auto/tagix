'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Card, CardBody, IconButton, Input, useToast } from '@hm/ui';
import { ErrorState, Skeleton } from '@/shared/components/feedback';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { READ_ONLY_TOOLTIP, useIsReadOnly } from '@/shared/components/account-banner/useIsReadOnly';
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
 * Cria/renomeia/deleta pipelines + gerencia estagios. DS 3.0: tokens semânticos,
 * remoção de estágio com confirmação inline (UX §2.9), escrita bloqueada em só leitura.
 */
export function PipelineSettingsPage(): React.JSX.Element {
  const { toast } = useToast();
  const readOnly = useIsReadOnly();
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
  // Remoção de estágio pede confirmação inline (os negócios mudam de estágio — UX §2.9).
  const [confirmStageId, setConfirmStageId] = useState<string | null>(null);

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
    if (!item) return;
    next.splice(target, 0, item);
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
        onSettled: () => setConfirmStageId(null),
      },
    );
  }

  if (pipelinesQuery.isLoading) {
    return (
      <div aria-busy aria-label="Carregando configurações">
        <PageHeader title="Configurar pipeline" />
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  if (pipelinesQuery.isError) {
    return (
      <div>
        <PageHeader title="Configurar pipeline" />
        <ErrorState
          error={pipelinesQuery.error}
          title="Não foi possível carregar as pipelines"
          action={
            <Button variant="secondary" size="sm" onClick={() => void pipelinesQuery.refetch()}>
              Tentar de novo
            </Button>
          }
        />
      </div>
    );
  }

  const writeTitle = readOnly ? READ_ONLY_TOOLTIP : undefined;

  return (
    <div className="flex flex-col">
      <Link
        href="/pipeline"
        className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-sm font-body text-sm font-bold text-text-mid outline-none transition-colors hover:text-text focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Pipeline
      </Link>

      <PageHeader
        title="Configurar pipeline"
        description={
          activePipeline ? (
            <span className="inline-flex items-center gap-1.5">
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  aria-label="Nome da pipeline"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename();
                    }
                    if (e.key === 'Escape') setIsRenaming(false);
                  }}
                  className="rounded-md border border-border-brand bg-surface px-2 py-1 font-body text-sm font-bold text-text outline-none focus-visible:focus-ring"
                />
              ) : (
                <button
                  type="button"
                  onClick={startRename}
                  disabled={readOnly}
                  title={writeTitle ?? 'Clique para renomear'}
                  className="group inline-flex items-center gap-1.5 rounded-sm font-body text-sm font-bold text-text-mid outline-none transition-colors hover:text-text focus-visible:focus-ring disabled:cursor-not-allowed"
                >
                  {activePipeline.name}
                  <Pencil
                    className="size-3.5 opacity-60 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  />
                </button>
              )}
            </span>
          ) : undefined
        }
        actions={
          <>
            <select
              value={activeId}
              onChange={(e) => setPipelineId(e.target.value)}
              aria-label="Selecionar pipeline"
              className="h-10 rounded-md border border-border bg-surface px-3 font-body text-sm font-bold text-text outline-none transition-colors hover:border-border-2 focus-visible:focus-ring"
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              onClick={() => setShowCreate(true)}
              disabled={readOnly}
              title={writeTitle}
              leftIcon={<Plus className="size-4" aria-hidden />}
            >
              Nova pipeline
            </Button>
            <IconButton
              variant="danger"
              onClick={() => setShowDelete(true)}
              disabled={pipelines.length <= 1 || readOnly}
              aria-label="Excluir pipeline"
              title={
                readOnly
                  ? READ_ONLY_TOOLTIP
                  : pipelines.length <= 1
                    ? 'Não é possível excluir a única pipeline'
                    : 'Excluir pipeline'
              }
              icon={<Trash2 />}
            />
          </>
        }
      />

      <Card elevation={1}>
        <CardBody className="flex flex-col gap-1 p-2 sm:p-3">
          <h2 className="px-2 pb-2 pt-1 font-mono text-xs font-semibold uppercase tracking-wider text-text-low">
            Estágios · <span className="tabular-nums">{stages.length}</span>
          </h2>
          {detail.isLoading ? (
            <div className="flex flex-col gap-2" aria-hidden>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 rounded-md" />
              ))}
            </div>
          ) : null}
          {stages.map((stage, index) => (
            <div
              key={stage.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-surface-2"
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  disabled={index === 0 || readOnly}
                  onClick={() => move(index, -1)}
                  aria-label={`Mover ${stage.name} para cima`}
                  className="grid size-8 place-items-center rounded-sm text-text-low outline-none transition-colors hover:text-text focus-visible:focus-ring disabled:opacity-30 pointer-coarse:size-11"
                >
                  <ChevronUp className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  disabled={index === stages.length - 1 || readOnly}
                  onClick={() => move(index, 1)}
                  aria-label={`Mover ${stage.name} para baixo`}
                  className="grid size-8 place-items-center rounded-sm text-text-low outline-none transition-colors hover:text-text focus-visible:focus-ring disabled:opacity-30 pointer-coarse:size-11"
                >
                  <ChevronDown className="size-4" aria-hidden />
                </button>
              </div>
              <input
                type="color"
                value={stage.color}
                disabled={readOnly}
                aria-label={`Cor do estágio ${stage.name}`}
                onChange={(e) => update.mutate({ id: stage.id, patch: { color: e.target.value } })}
                className="size-8 cursor-pointer rounded-md border border-border bg-surface p-0.5 outline-none focus-visible:focus-ring disabled:cursor-not-allowed"
              />
              <Input
                value={stage.name}
                disabled={readOnly}
                aria-label="Nome do estágio"
                onChange={(e) =>
                  setStages((prev) =>
                    prev.map((s) => (s.id === stage.id ? { ...s, name: e.target.value } : s)),
                  )
                }
                onBlur={(e) => update.mutate({ id: stage.id, patch: { name: e.target.value } })}
                className="min-w-40 flex-1"
              />
              {confirmStageId === stage.id ? (
                <div
                  className="flex items-center gap-2"
                  role="group"
                  aria-label={`Confirmar remoção de ${stage.name}`}
                >
                  <span className="font-body text-xs text-text-mid">
                    Negócios vão para{' '}
                    <strong className="font-bold text-text">
                      {stages.find((s) => s.id !== stage.id)?.name ?? 'outro estágio'}
                    </strong>
                    .
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmStageId(null)}>
                    Voltar
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={remove.isPending}
                    onClick={() => deleteStage(stage)}
                  >
                    Remover
                  </Button>
                </div>
              ) : (
                <IconButton
                  variant="danger"
                  size="sm"
                  disabled={readOnly || stages.length <= 1}
                  onClick={() => setConfirmStageId(stage.id)}
                  aria-label={`Remover estágio ${stage.name}`}
                  icon={<Trash2 />}
                />
              )}
            </div>
          ))}

          <div className="flex items-center gap-2 border-t border-border px-2 pt-3">
            <Input
              value={newName}
              disabled={readOnly}
              aria-label="Nome do novo estágio"
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
            <Button
              variant="secondary"
              loading={create.isPending}
              disabled={!newName.trim() || readOnly}
              title={writeTitle}
              onClick={addStage}
              leftIcon={<Plus className="size-4" aria-hidden />}
            >
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
