'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type {
  ConversationDetail,
  ConversationFilters,
  ConversationSummary,
  MessageItem,
} from './types';

function toQuery(filters: ConversationFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useConversations(filters: ConversationFilters = {}) {
  return useQuery({
    queryKey: ['conversations', filters],
    queryFn: () =>
      api.get<{ conversations: ConversationSummary[] }>(`/api/conversations${toQuery(filters)}`),
  });
}

/** Chave de cache de uma conversa individual. Fonte única compartilhada pelo cockpit. */
export function conversationDetailKey(conversationId: string) {
  return ['conversation', conversationId, 'detail'] as const;
}

/**
 * Detalhe completo de uma conversa (status, aiMode, assignedTo, departmentId…).
 * Usa GET /api/conversations/:id. Habilitado somente quando conversationId existe.
 * F30-S03: alimenta o cockpit do ContactInfoPanel.
 */
export function useConversationDetail(conversationId: string | undefined) {
  return useQuery({
    queryKey: conversationDetailKey(conversationId ?? ''),
    queryFn: () =>
      api.get<{ conversation: ConversationDetail }>(
        `/api/conversations/${conversationId}`,
      ),
    enabled: Boolean(conversationId),
    staleTime: 10_000,
  });
}

export function useMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: ['conversation', conversationId, 'messages'],
    queryFn: () =>
      api.get<{ messages: MessageItem[] }>(`/api/conversations/${conversationId}/messages`),
    enabled: Boolean(conversationId),
  });
}

/** Chave de cache das mensagens — única fonte de verdade, compartilhada com `useMessages`. */
export function messagesKey(conversationId: string) {
  return ['conversation', conversationId, 'messages'] as const;
}

/** Payload de envio: texto e/ou mídia já hospedada (mediaUrl assinado). */
export interface SendMessageInput {
  conversationId: string;
  /** Texto da mensagem (legenda quando há mídia). `null` quando só mídia. */
  content: string | null;
  /** `text` por padrão; `image`/`file`/etc. quando há mídia anexada. */
  type: string;
  /** URL pública/assinada da mídia já enviada ao storage (R2). */
  mediaUrl?: string | null;
}

interface SendMutationContext {
  previous: { messages: MessageItem[] } | undefined;
  optimisticId: string;
}

/**
 * Envia uma mensagem com UI otimista (UX §2.7 — feedback imediato).
 * Insere a bolha localmente antes da resposta da API e reconcilia com a
 * mensagem real no sucesso; faz rollback no erro. `ApiError` (com `ref`)
 * propaga para o chamador tratar via toast/ErrorState.
 *
 * Contrato backend (pendente, ver F1 API): `POST /api/conversations/:id/messages`
 * com `{ content, type, mediaUrl }` → `{ message: MessageItem }`.
 */
export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation<{ message: MessageItem }, Error, SendMessageInput, SendMutationContext>({
    mutationFn: ({ conversationId, content, type, mediaUrl }) =>
      api.post<{ message: MessageItem }>(`/api/conversations/${conversationId}/messages`, {
        content,
        type,
        mediaUrl: mediaUrl ?? null,
      }),

    onMutate: async (input): Promise<SendMutationContext> => {
      const key = messagesKey(input.conversationId);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<{ messages: MessageItem[] }>(key);
      const optimisticId = `optimistic-${crypto.randomUUID()}`;
      const optimistic: MessageItem = {
        id: optimisticId,
        conversationId: input.conversationId,
        direction: 'outbound',
        senderType: 'agent',
        type: input.type,
        content: input.content,
        viewStatus: 'sending',
        mediaUrl: input.mediaUrl ?? null,
        createdAt: new Date().toISOString(),
      };

      // A API ordena por createdAt desc → a mais nova é o primeiro item.
      queryClient.setQueryData<{ messages: MessageItem[] }>(key, (curr) => ({
        messages: [optimistic, ...(curr?.messages ?? [])],
      }));

      return { previous, optimisticId };
    },

    onError: (_err, input, context) => {
      if (!context) return;
      // Rollback completo ao snapshot anterior.
      queryClient.setQueryData(messagesKey(input.conversationId), context.previous);
    },

    onSuccess: ({ message }, input, context) => {
      // Substitui a bolha otimista pela mensagem real (mantém posição).
      queryClient.setQueryData<{ messages: MessageItem[] }>(
        messagesKey(input.conversationId),
        (curr) => ({
          messages: (curr?.messages ?? []).map((m) =>
            m.id === context?.optimisticId ? message : m,
          ),
        }),
      );
    },

    onSettled: (_data, _err, input) => {
      void queryClient.invalidateQueries({ queryKey: messagesKey(input.conversationId) });
    },
  });
}

// ── Status mutation (F30-S03 / LIVECHAT_OPS §2) ───────────────────────────────

export interface ChangeStatusInput {
  conversationId: string;
  status: 'open' | 'pending' | 'resolved' | 'snoozed';
  snoozedUntil?: string; // ISO date string
}

interface ChangeStatusResult {
  conversationId: string;
  status: string;
  snoozedUntil: string | null;
}

/**
 * Muta o status operacional da conversa (resolver / snooze / reabrir / pendente).
 * POST /api/conversations/:id/status. Invalida o detalhe e a lista.
 * UX §2.7: botão em loading durante a chamada.
 */
export function useChangeStatus() {
  const queryClient = useQueryClient();

  return useMutation<ChangeStatusResult, Error, ChangeStatusInput>({
    mutationFn: ({ conversationId, status, snoozedUntil }) =>
      api.post<ChangeStatusResult>(`/api/conversations/${conversationId}/status`, {
        status,
        ...(snoozedUntil ? { snoozedUntil } : {}),
      }),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: conversationDetailKey(input.conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

// ── AI Mode mutation (F30-S03 / LIVECHAT_OPS §2) ─────────────────────────────

import type { AiMode } from '@hm/shared';

export interface ChangeAiModeInput {
  conversationId: string;
  aiMode: AiMode;
}

interface ChangeAiModeResult {
  conversationId: string;
  aiMode: AiMode;
  reason: string | null;
}

/**
 * Liga / desliga / pausa a IA numa conversa (handoff consciente).
 * POST /api/conversations/:id/ai-mode. Invalida o detalhe e a lista.
 * UX §2.7: feedback imediato via loading state no botão.
 */
export function useChangeAiMode() {
  const queryClient = useQueryClient();

  return useMutation<ChangeAiModeResult, Error, ChangeAiModeInput>({
    mutationFn: ({ conversationId, aiMode }) =>
      api.post<ChangeAiModeResult>(`/api/conversations/${conversationId}/ai-mode`, { aiMode }),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: conversationDetailKey(input.conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

// ── Agente da conversa (F34-S04 / AGENT_DEPARTMENT_ROUTING_PLAN D4) ───────────

/** Candidato a atender a conversa (agente ativo elegível ao departamento). */
export interface AgentCandidate {
  id: string;
  name: string;
}

interface ConversationAgentResult {
  currentAgentId: string | null;
  currentAgentName: string | null;
  candidates: AgentCandidate[];
}

/** Chave de cache do agente atual + candidatos de uma conversa. */
export function conversationAgentKey(conversationId: string) {
  return ['conversation', conversationId, 'agent'] as const;
}

/**
 * Agente de IA atual da conversa + candidatos elegíveis ao(s) departamento(s).
 * GET /api/conversations/:id/agent. Gated por `conversation.assign_agent` no
 * backend; o caller deve habilitar apenas quando o role tiver a permissão.
 */
export function useConversationAgent(conversationId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: conversationAgentKey(conversationId ?? ''),
    queryFn: () =>
      api.get<ConversationAgentResult>(`/api/conversations/${conversationId}/agent`),
    enabled: Boolean(conversationId) && enabled,
    staleTime: 30_000,
  });
}

export interface AssignAgentInput {
  conversationId: string;
  agentId: string;
}

interface AssignAgentResult {
  conversationId: string;
  agentId: string;
}

/**
 * Troca o agente de IA que atende a conversa (re-engaja a IA no backend).
 * POST /api/conversations/:id/agent. Invalida o agente, o detalhe e a lista.
 * UX §2.7: o seletor entra em loading durante a mutation.
 */
export function useAssignAgent() {
  const queryClient = useQueryClient();

  return useMutation<AssignAgentResult, Error, AssignAgentInput>({
    mutationFn: ({ conversationId, agentId }) =>
      api.post<AssignAgentResult>(`/api/conversations/${conversationId}/agent`, { agentId }),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: conversationAgentKey(input.conversationId) });
      void queryClient.invalidateQueries({
        queryKey: conversationDetailKey(input.conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}
