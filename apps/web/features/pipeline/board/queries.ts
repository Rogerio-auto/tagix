'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
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

export function usePipelines() {
  return useQuery({
    queryKey: pipelineKeys.list(),
    queryFn: () => api.get<{ pipelines: Pipeline[] }>('/api/pipelines'),
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
 * Move um deal de stage com OPTIMISTIC update + revert em erro (PIPELINE.md §6.2).
 * O socket `deal:stage_changed` (F5-S07) reconcilia via invalidação no listener.
 */
export function useMoveDeal(pipelineId: string) {
  const qc = useQueryClient();
  const key = pipelineKeys.deals(pipelineId);
  return useMutation<{ deal: Deal }, Error, MoveDealVars, { previous?: { deals: Deal[] } }>({
    mutationFn: ({ dealId, stageId }) =>
      api.post<{ deal: Deal }>(`/api/deals/${dealId}/move-stage`, { stageId }),
    onMutate: async ({ dealId, stageId }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<{ deals: Deal[] }>(key);
      if (previous) {
        qc.setQueryData<{ deals: Deal[] }>(key, {
          deals: previous.deals.map((d) => (d.id === dealId ? { ...d, stageId } : d)),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}
