'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/lib/api-client';
import type {
  Agent,
  AgentModel,
  AgentStatus,
  AgentTemplate,
  CreateAgentInput,
} from './types';

/**
 * React Query hooks da feature de agentes IA. Owned por F2-S17; F2-S18/S19
 * importam read-only. `queryKeys` é a única fonte de verdade das chaves de cache
 * (compartilhada entre slots — evita invalidações fora de sincronia).
 *
 * Endpoints consumidos (F2-S16, merged):
 *   GET   /api/agents                 — lista
 *   GET   /api/agents/:id             — detalhe
 *   POST  /api/agents                 — cria (a partir de template)
 *   PATCH /api/agents/:id/status      — ativa/desativa/arquiva
 *
 * Gap-fills do orchestrator (codificados contra o contrato exato; degradam se 404):
 *   GET   /api/agents/models     → { models: AgentModel[] }
 *   GET   /api/agents/templates  → { templates: AgentTemplate[] }
 */
export const queryKeys = {
  all: ['agents'] as const,
  lists: () => [...queryKeys.all, 'list'] as const,
  detail: (id: string) => [...queryKeys.all, 'detail', id] as const,
  models: () => [...queryKeys.all, 'models'] as const,
  templates: () => [...queryKeys.all, 'templates'] as const,
};

/* ------------------------------------------------------------------ */
/* Lista + detalhe                                                     */
/* ------------------------------------------------------------------ */

export function useAgents() {
  return useQuery({
    queryKey: queryKeys.lists(),
    queryFn: () => api.get<{ agents: Agent[] }>('/api/agents'),
  });
}

export function useAgent(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.detail(id ?? ''),
    queryFn: () => api.get<{ agent: Agent }>(`/api/agents/${id}`),
    enabled: Boolean(id),
  });
}

/* ------------------------------------------------------------------ */
/* Criação                                                            */
/* ------------------------------------------------------------------ */

/** Cria um agente a partir de um template. Invalida a lista no sucesso. */
export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation<{ agent: Agent }, Error, CreateAgentInput>({
    mutationFn: (input) => api.post<{ agent: Agent }>('/api/agents', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists() });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Status (ativar/desativar/arquivar)                                 */
/* ------------------------------------------------------------------ */

/** Ativa/desativa/arquiva um agente via atalho de status. Invalida lista + detalhe. */
export function useSetAgentStatus() {
  const queryClient = useQueryClient();
  return useMutation<{ agent: Agent }, Error, { id: string; status: AgentStatus }>({
    mutationFn: ({ id, status }) =>
      api.patch<{ agent: Agent }>(`/api/agents/${id}/status`, { status }),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.detail(id) });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Catálogo de modelos (policy do workspace) — gap-fill, degrada      */
/* ------------------------------------------------------------------ */

/**
 * Modelos disponíveis filtrados pela policy do workspace.
 *
 * `GET /api/agents/models` é um gap-fill do orchestrator. Enquanto não existir
 * (404), o hook retorna `[]` em vez de propagar erro — o wizard cai no modelo
 * default do template. Outros erros são propagados normalmente.
 */
export function useAgentModels(enabled = true) {
  return useQuery({
    queryKey: queryKeys.models(),
    enabled,
    queryFn: async (): Promise<AgentModel[]> => {
      try {
        const { models } = await api.get<{ models: AgentModel[] }>('/api/agents/models');
        return models;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return [];
        throw err;
      }
    },
  });
}

/* ------------------------------------------------------------------ */
/* Templates + perguntas — gap-fill, degrada                          */
/* ------------------------------------------------------------------ */

/**
 * Templates de agente (globais + do workspace) com suas perguntas.
 *
 * `GET /api/agents/templates` é um gap-fill do orchestrator. Enquanto não
 * existir (404), retorna `[]` — o wizard mostra o empty state de "sem templates"
 * em vez de quebrar.
 */
export function useAgentTemplates(enabled = true) {
  return useQuery({
    queryKey: queryKeys.templates(),
    enabled,
    queryFn: async (): Promise<AgentTemplate[]> => {
      try {
        const { templates } = await api.get<{ templates: AgentTemplate[] }>(
          '/api/agents/templates',
        );
        return templates;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return [];
        throw err;
      }
    },
  });
}
