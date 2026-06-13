'use client';

/**
 * React Query hooks do editor de políticas por workspace (F25-S07) sobre a API
 * F25-S03. Reusa fetchers de `features/platform-admin/lib`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformModels, platformPolicies } from '@/features/platform-admin/lib';
import type { WorkspaceAgentPolicy } from '@/features/platform-admin/lib';

export function useWorkspaceList() {
  return useQuery({
    queryKey: ['platform', 'workspaces'],
    queryFn: () => platformPolicies.workspaces(),
  });
}

export function useActiveModels() {
  return useQuery({
    queryKey: ['platform', 'models', 'active'],
    queryFn: async () => {
      const { models } = await platformModels.list();
      return models.filter((m) => m.isActive);
    },
  });
}

export function usePolicy(workspaceId: string | null) {
  return useQuery({
    queryKey: ['platform', 'policy', workspaceId],
    queryFn: () => platformPolicies.get(workspaceId!),
    enabled: workspaceId !== null,
  });
}

export function useUpdatePolicy() {
  const qc = useQueryClient();
  return useMutation<
    { policy: WorkspaceAgentPolicy },
    Error,
    { workspaceId: string; body: Partial<WorkspaceAgentPolicy> }
  >({
    mutationFn: ({ workspaceId, body }) => platformPolicies.update(workspaceId, body),
    onSuccess: (_d, v) =>
      void qc.invalidateQueries({ queryKey: ['platform', 'policy', v.workspaceId] }),
  });
}
