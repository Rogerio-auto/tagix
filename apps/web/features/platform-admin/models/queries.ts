'use client';

/**
 * React Query hooks do catálogo de modelos (F25-S07) sobre a API F25-S02
 * (`/api/platform/models`). Reusa os fetchers tipados de `features/platform-admin/lib`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformModels } from '@/features/platform-admin/lib';
import type { LlmModel } from '@/features/platform-admin/lib';

const modelsKey = ['platform', 'models'] as const;

export function useModels() {
  return useQuery({ queryKey: modelsKey, queryFn: () => platformModels.list() });
}

export function usePatchModel() {
  const qc = useQueryClient();
  return useMutation<
    { model: LlmModel },
    Error,
    { id: string; patch: Partial<Pick<LlmModel, 'isActive' | 'defaultPlanKeys' | 'notes'>> }
  >({
    mutationFn: ({ id, patch }) => platformModels.patch(id, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: modelsKey }),
  });
}

export function useSyncModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => platformModels.sync(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: modelsKey }),
  });
}
