'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/lib/api-client';
import type { Agent, AgentDepartmentLink } from '../types';
import { queryKeys } from '../queries';
import type { AgentMetric, AgentToolState } from './types';

/**
 * React Query hooks específicos do detalhe do agente (F2-S18). Reusa as
 * `queryKeys` e os hooks de F2-S17 (`../queries`) — read-only — e adiciona só o
 * que é exclusivo do detalhe: update de config, tools por agente e métricas.
 *
 * Endpoints consumidos (F2-S16, merged):
 *   PATCH /api/agents/:id              — salvar config (ConfigTab)
 *   GET   /api/agents/:id/tools        — catálogo + estado por agente (ToolsTab)
 *   PUT   /api/agents/:id/tools/:toolId — toggle agent↔tool          (ToolsTab)
 *
 * Gap-fill do orchestrator (codificado contra o contrato exato; degrada se 404):
 *   GET   /api/agents/:id/metrics → { metrics: AgentMetric[] }       (MetricsTab)
 */

/** Chaves de cache específicas do detalhe (derivadas de `queryKeys.detail`). */
export const detailKeys = {
  tools: (id: string) => [...queryKeys.detail(id), 'tools'] as const,
  metrics: (id: string) => [...queryKeys.detail(id), 'metrics'] as const,
};

/* ------------------------------------------------------------------ */
/* Config — update (PATCH /api/agents/:id)                             */
/* ------------------------------------------------------------------ */

/**
 * Campos editáveis pela ConfigTab. Espelha o `updateSchema` da API (F2-S16):
 * todos opcionais; só os campos presentes são enviados. `null` zera campos
 * `nullish` (ex.: limpar visionModel).
 */
export interface UpdateAgentInput {
  name?: string;
  description?: string | null;
  systemPrompt?: string;
  model?: string;
  modelParams?: Record<string, unknown>;
  visionModel?: string | null;
  transcriptionModel?: string | null;
  aggregationEnabled?: boolean;
  aggregationWindowSec?: number;
  maxBatchMessages?: number;
  replyIfIdleSec?: number | null;
  allowHandoff?: boolean;
  ignoreGroupMessages?: boolean;
  /**
   * Conjunto completo de departamentos do agente (replace-all, F34-S02). Quando
   * presente, substitui TODOS os vínculos; `[]` desvincula. Omitir não mexe.
   */
  departments?: AgentDepartmentLink[];
}

/** Salva a config do agente. Invalida o detalhe no sucesso. */
export function useUpdateAgent(id: string) {
  const queryClient = useQueryClient();
  return useMutation<{ agent: Agent }, Error, UpdateAgentInput>({
    mutationFn: (input) => api.patch<{ agent: Agent }>(`/api/agents/${id}`, input),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.detail(id), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists() });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Tools — catálogo + estado por agente                                */
/* ------------------------------------------------------------------ */

/** Catálogo de tools com o estado (isEnabled/overrides) por agente. */
export function useAgentTools(id: string | undefined) {
  return useQuery({
    queryKey: detailKeys.tools(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => api.get<{ tools: AgentToolState[] }>(`/api/agents/${id}/tools`),
  });
}

/** Liga/desliga uma tool no agente. Invalida o estado de tools no sucesso. */
export function useToggleAgentTool(id: string) {
  const queryClient = useQueryClient();
  return useMutation<
    { agentTool: { agentId: string; toolId: string; isEnabled: boolean; overrides: Record<string, unknown> } },
    Error,
    { toolId: string; isEnabled: boolean }
  >({
    mutationFn: ({ toolId, isEnabled }) =>
      api.put(`/api/agents/${id}/tools/${toolId}`, { isEnabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: detailKeys.tools(id) });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Métricas — gap-fill, degrada                                        */
/* ------------------------------------------------------------------ */

/**
 * Métricas agregadas do agente.
 *
 * `GET /api/agents/:id/metrics` é um **gap-fill do orchestrator**. Enquanto não
 * existir (404), o hook retorna `[]` em vez de propagar erro — a MetricsTab mostra
 * o empty state em vez de quebrar. Outros erros são propagados normalmente.
 */
export function useAgentMetrics(id: string | undefined) {
  return useQuery({
    queryKey: detailKeys.metrics(id ?? ''),
    enabled: Boolean(id),
    queryFn: async (): Promise<AgentMetric[]> => {
      try {
        const { metrics } = await api.get<{ metrics: AgentMetric[] }>(
          `/api/agents/${id}/metrics`,
        );
        return metrics;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return [];
        throw err;
      }
    },
  });
}
