'use client';

/**
 * React Query do Agent Playground de plataforma (F26-S10): seletor de tenant+agente
 * e modelos permitidos. Reusa a API F26-S02 (tenants) e endpoints de plataforma.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

export function useTenantOptions() {
  return useQuery({
    queryKey: ['platform', 'tenants', 'selector'],
    queryFn: () =>
      api.get<{ tenants: { id: string; name: string; slug: string }[] }>(
        '/api/platform/tenants?limit=100',
      ),
  });
}

export interface AgentOption {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly status: string;
}

export function useTenantAgents(workspaceId: string) {
  return useQuery({
    queryKey: ['platform', 'tenant', workspaceId, 'agents'],
    queryFn: async () => {
      const w = await api.get<{ agents: AgentOption[] }>(`/api/platform/tenants/${workspaceId}`);
      return w.agents;
    },
    enabled: Boolean(workspaceId),
  });
}

export interface PlaygroundModels {
  readonly allowedModels: readonly string[];
}

export function useWorkspaceModels(workspaceId: string) {
  return useQuery({
    queryKey: ['platform', 'workspace', workspaceId, 'agent-policy'],
    queryFn: () =>
      api.get<{ policy: { allowedModels: string[] } }>(
        `/api/platform/workspaces/${workspaceId}/agent-policy`,
      ),
    enabled: Boolean(workspaceId),
  });
}
