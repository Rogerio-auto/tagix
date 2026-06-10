'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { CreateFlowInput, Flow, ManualOrderItem } from './types';

/**
 * React Query hooks da lista de flows (F4-S09). Consome a API de F4-S08:
 *   GET   /api/flows                      lista
 *   POST  /api/flows                      cria draft
 *   POST  /api/flows/:id/{publish,unpublish,archive}
 *   PATCH /api/flows/manual-order         reordena manual
 */
export const flowKeys = {
  all: ['flows'] as const,
  lists: () => [...flowKeys.all, 'list'] as const,
};

export function useFlows() {
  return useQuery({
    queryKey: flowKeys.lists(),
    queryFn: () => api.get<{ flows: Flow[] }>('/api/flows'),
  });
}

export function useCreateFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFlowInput) => api.post<{ flow: Flow }>('/api/flows', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: flowKeys.lists() }),
  });
}

type LifecycleAction = 'publish' | 'unpublish' | 'archive';

export function useFlowLifecycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: LifecycleAction }) =>
      api.post<{ flow: Flow }>(`/api/flows/${id}/${action}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: flowKeys.lists() }),
  });
}

export function useReorderManualFlows() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (order: ManualOrderItem[]) => api.patch<void>('/api/flows/manual-order', { order }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: flowKeys.lists() }),
  });
}
