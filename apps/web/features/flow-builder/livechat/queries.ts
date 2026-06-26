'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

export interface ManualFlow {
  id: string;
  name: string;
  status: string;
  triggerType: string;
  manualPosition: number | null;
}

export interface ConversationExecution {
  id: string;
  flowId: string;
  /** Nome do flow (F51 — enriquecido no GET por leftJoin; null se flow deletado). */
  flowName: string | null;
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  currentNodeId: string | null;
  startedAt: string;
  /** Deadline do próximo passo quando `waiting` (ISO); null em running/terminal. */
  nextStepAt: string | null;
  completedAt: string | null;
  lastError: string | null;
}

export interface ExecutionLog {
  id: string;
  nodeId: string;
  nodeType: string;
  level: string;
  message: string | null;
  createdAt: string;
}

const ACTIVE = new Set(['running', 'waiting']);

/** Flows manuais ATIVOS, ordenados por manual_position (quickbar). */
export function useManualFlows() {
  return useQuery({
    queryKey: ['flows', 'manual'],
    queryFn: async () => {
      const { flows } = await api.get<{ flows: ManualFlow[] }>('/api/flows');
      return flows
        .filter((f) => f.triggerType === 'manual' && f.status === 'active')
        .sort((a, b) => (a.manualPosition ?? 0) - (b.manualPosition ?? 0));
    },
  });
}

/** Execucoes ATIVAS de uma conversa (badge). Poll leve + invalidacao por socket. */
export function useConversationExecutions(conversationId: string) {
  return useQuery({
    queryKey: ['flow-executions', 'conversation', conversationId],
    queryFn: async () => {
      const { executions } = await api
        .get<{
          executions: ConversationExecution[];
        }>(`/api/flows/executions?conversationId=${conversationId}`)
        .catch(() => ({ executions: [] as ConversationExecution[] }));
      return executions.filter((e) => ACTIVE.has(e.status));
    },
    enabled: conversationId.length > 0,
    refetchInterval: 8000,
  });
}

/**
 * TODAS as execuções de uma conversa (cockpit F51 — ativas + recém-finalizadas). Mesma queryKey
 * do badge (uma invalidação atualiza ambos); o recorte ativos/terminais é feito no componente.
 * Socket é o caminho primário (`useFlowExecutionsLive`); `refetchInterval` é rede de segurança.
 */
export function useCockpitExecutions(conversationId: string) {
  return useQuery({
    queryKey: ['flow-executions', 'conversation', conversationId],
    queryFn: async () => {
      const { executions } = await api
        .get<{
          executions: ConversationExecution[];
        }>(`/api/flows/executions?conversationId=${conversationId}`)
        .catch(() => ({ executions: [] as ConversationExecution[] }));
      return executions;
    },
    enabled: conversationId.length > 0,
    refetchInterval: 8000,
  });
}

export function useTriggerFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ flowId, conversationId }: { flowId: string; conversationId: string }) =>
      api.post<{ executionId: string }>(`/api/flows/${flowId}/trigger`, { conversationId }),
    onSuccess: (_d, vars) =>
      void qc.invalidateQueries({
        queryKey: ['flow-executions', 'conversation', vars.conversationId],
      }),
  });
}

export function useExecutionDetail(executionId: string | null) {
  return useQuery({
    queryKey: ['flow-execution', executionId],
    queryFn: () =>
      api.get<{ execution: ConversationExecution; logs: ExecutionLog[] }>(
        `/api/flow-executions/${executionId}`,
      ),
    enabled: !!executionId,
  });
}

export function useCancelConversationExecution(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (executionId: string) =>
      api.post<void>(`/api/flow-executions/${executionId}/cancel`),
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: ['flow-executions', 'conversation', conversationId],
      }),
  });
}
