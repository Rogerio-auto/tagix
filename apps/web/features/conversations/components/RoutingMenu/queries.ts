'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type {
  AssignInput,
  AssignableMember,
  RoutingDepartment,
  RoutingHistoryEntry,
  TransferInput,
} from './types';

interface RoutingTargetsResult {
  members: AssignableMember[];
  departments: RoutingDepartment[];
}

/**
 * Membros + departamentos elegíveis como alvo de atribuição/transferência.
 * GET /api/conversations/routing-targets (gated por `conversation.assign`).
 * Habilitar só quando o menu abre (lazy) — o caller passa `enabled`.
 */
export function useRoutingTargets(enabled: boolean) {
  return useQuery({
    queryKey: ['conversations', 'routing-targets'] as const,
    queryFn: () => api.get<RoutingTargetsResult>('/api/conversations/routing-targets'),
    enabled,
    staleTime: 60_000,
  });
}

/** Chave de cache da trilha de roteamento de uma conversa (fonte única). */
export function routingHistoryKey(conversationId: string) {
  return ['conversation', conversationId, 'routing', 'history'] as const;
}

/** Lista a trilha de roteamento da conversa (mais recentes primeiro). */
export function useRoutingHistory(conversationId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: routingHistoryKey(conversationId ?? ''),
    queryFn: () =>
      api.get<{ history: RoutingHistoryEntry[] }>(
        `/api/conversations/${conversationId}/routing/history`,
      ),
    enabled: Boolean(conversationId) && enabled,
  });
}

interface AssignResult {
  conversationId: string;
  assignedTo: string | null;
}

interface TransferResult {
  conversationId: string;
  assignedTo: string | null;
  departmentId: string | null;
}

/**
 * Atribui a conversa a um member (assign-to-me ou a outro). Invalida a trilha e
 * a lista de conversas no sucesso. UX §2.7: botão em loading durante a chamada.
 */
export function useAssignConversation() {
  const queryClient = useQueryClient();

  return useMutation<AssignResult, Error, AssignInput>({
    mutationFn: ({ conversationId, memberId }) =>
      api.post<AssignResult>(`/api/conversations/${conversationId}/assign`, { memberId }),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: routingHistoryKey(input.conversationId) });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

/**
 * Transfere a conversa para outro member e/ou department, com `reason` opcional.
 * Invalida a trilha e a lista de conversas no sucesso.
 */
export function useTransferConversation() {
  const queryClient = useQueryClient();

  return useMutation<TransferResult, Error, TransferInput>({
    mutationFn: ({ conversationId, memberId, departmentId, reason }) =>
      api.post<TransferResult>(`/api/conversations/${conversationId}/transfer`, {
        memberId,
        departmentId,
        reason,
      }),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: routingHistoryKey(input.conversationId) });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}
