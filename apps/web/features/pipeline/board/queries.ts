'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import { applyMove, revertMove } from './stageMove';
import type { CreateDealInput, Deal, Pipeline, Stage } from './types';

/**
 * React Query hooks do pipeline/kanban (F5-S09). Consome a API de F5-S04/S05.
 * `queryKeys` é a fonte única das chaves (compartilhada com S10/S07 reconcile).
 */
export const pipelineKeys = {
  all: ['pipelines'] as const,
  list: () => [...pipelineKeys.all, 'list'] as const,
  detail: (id: string) => [...pipelineKeys.all, 'detail', id] as const,
  deals: (pipelineId: string) => ['deals', pipelineId] as const,
};

export interface PipelineListResponse {
  data: Pipeline[];
  meta: { limit: number; current: number };
}

export function usePipelines() {
  return useQuery({
    queryKey: pipelineKeys.list(),
    queryFn: () => api.get<PipelineListResponse>('/api/pipelines'),
  });
}

export function usePipelineDetail(id: string | undefined) {
  return useQuery({
    queryKey: pipelineKeys.detail(id ?? ''),
    queryFn: () => api.get<{ pipeline: Pipeline; stages: Stage[] }>(`/api/pipelines/${id}`),
    enabled: Boolean(id),
  });
}

export function useDeals(pipelineId: string | undefined) {
  return useQuery({
    queryKey: pipelineKeys.deals(pipelineId ?? ''),
    queryFn: () => api.get<{ deals: Deal[] }>(`/api/deals?pipelineId=${pipelineId}`),
    enabled: Boolean(pipelineId),
  });
}

export function useCreateDeal(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation<{ deal: Deal }, Error, CreateDealInput>({
    mutationFn: (input) => api.post<{ deal: Deal }>('/api/deals', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pipelineKeys.deals(pipelineId) });
    },
  });
}

export interface MoveDealVars {
  dealId: string;
  stageId: string;
}

/**
 * Callbacks POR MOVIMENTO, registrados no hook. No TanStack Query v5 os callbacks passados
 * a `mutate()` só disparam para a última chamada: dois movimentos rápidos engoliriam o erro
 * do primeiro. Aqui cada chamada recebe o próprio erro/fim, identificada por `vars`.
 */
export interface MoveDealCallbacks {
  readonly onError?: (error: Error, vars: MoveDealVars) => void;
  readonly onSettled?: (vars: MoveDealVars) => void;
}

/**
 * Move um deal de stage com OPTIMISTIC update + revert em erro (PIPELINE.md §6.2).
 * O socket `deal:stage_changed` (F5-S07) reconcilia via invalidação no listener.
 * O revert desfaz só o deal que falhou: outro movimento em voo continua de pé.
 */
export function useMoveDeal(pipelineId: string, callbacks: MoveDealCallbacks = {}) {
  const qc = useQueryClient();
  const key = pipelineKeys.deals(pipelineId);
  return useMutation<{ deal: Deal }, Error, MoveDealVars, { previous?: { deals: Deal[] } }>({
    mutationFn: ({ dealId, stageId }) =>
      api.post<{ deal: Deal }>(`/api/deals/${dealId}/move-stage`, { stageId }),
    onMutate: async ({ dealId, stageId }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<{ deals: Deal[] }>(key);
      if (previous) {
        // `updatedAt` agora: o "tempo na etapa" do card zera junto com o movimento, sem
        // esperar o refetch; `position` igual à que o servidor grava (topo da etapa).
        const movedAt = new Date().toISOString();
        qc.setQueryData<{ deals: Deal[] }>(key, {
          deals: applyMove(previous.deals, dealId, stageId, movedAt),
        });
      }
      return { previous };
    },
    onError: (err, vars, ctx) => {
      const previous = ctx?.previous;
      if (previous) {
        qc.setQueryData<{ deals: Deal[] }>(key, (cur) =>
          cur ? { deals: revertMove(cur.deals, previous.deals, vars.dealId, vars.stageId) } : previous,
        );
      }
      callbacks.onError?.(err, vars);
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: key });
      callbacks.onSettled?.(vars);
    },
  });
}

// ---------------------------------------------------------------------------
// Pipeline CRUD mutations (F35-S01) — reutilizadas por Settings e Board
// ---------------------------------------------------------------------------

export interface CreatePipelineInput {
  name: string;
}

export interface UpdatePipelineInput {
  name: string;
}

/** Erro retornado pelo backend quando o workspace atingiu o limite de pipelines. */
export interface PipelineLimitError {
  error: 'pipeline_limit_reached';
  current: number;
  max: number;
}

export function useCreatePipeline() {
  const qc = useQueryClient();
  return useMutation<{ pipeline: Pipeline }, Error & { body?: PipelineLimitError }, CreatePipelineInput>({
    mutationFn: (input) => api.post<{ pipeline: Pipeline }>('/api/pipelines', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pipelineKeys.list() });
    },
  });
}

export function useUpdatePipeline() {
  const qc = useQueryClient();
  return useMutation<
    { pipeline: Pipeline },
    Error,
    { id: string } & UpdatePipelineInput
  >({
    mutationFn: ({ id, name }) => api.put<{ pipeline: Pipeline }>(`/api/pipelines/${id}`, { name }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: pipelineKeys.list() });
      void qc.invalidateQueries({ queryKey: pipelineKeys.detail(vars.id) });
    },
  });
}

export function useDeletePipeline() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => api.delete<void>(`/api/pipelines/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pipelineKeys.list() });
    },
  });
}
