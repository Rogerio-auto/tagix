'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import { pipelineKeys } from '../board/queries';
import type { Stage } from '../board/types';

/** Mutations de settings de stages (F5-S09, API F5-S04). Invalidam o detail do pipeline. */
export function useUpdateStage(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation<{ stage: Stage }, Error, { id: string; patch: Partial<Stage> }>({
    mutationFn: ({ id, patch }) => api.put<{ stage: Stage }>(`/api/stages/${id}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pipelineKeys.detail(pipelineId) });
    },
  });
}

export function useReorderStages(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; position: number }[]>({
    mutationFn: (order) => api.patch<void>('/api/stages/reorder', { pipelineId, order }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pipelineKeys.detail(pipelineId) });
    },
  });
}

export function useCreateStage(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation<{ stage: Stage }, Error, { name: string; position: number; color?: string }>({
    mutationFn: (input) => api.post<{ stage: Stage }>(`/api/pipelines/${pipelineId}/stages`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pipelineKeys.detail(pipelineId) });
    },
  });
}

export function useDeleteStage(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; fallbackStageId?: string }>({
    mutationFn: ({ id, fallbackStageId }) =>
      api.delete<void>(
        `/api/stages/${id}${fallbackStageId ? `?fallbackStageId=${fallbackStageId}` : ''}`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pipelineKeys.detail(pipelineId) });
    },
  });
}
