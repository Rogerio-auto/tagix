'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { ConversationFilters, ConversationSummary, MessageItem } from './types';

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
    queryFn: () => api.get<{ conversations: ConversationSummary[] }>(`/api/conversations${toQuery(filters)}`),
  });
}

export function useMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: ['conversation', conversationId, 'messages'],
    queryFn: () => api.get<{ messages: MessageItem[] }>(`/api/conversations/${conversationId}/messages`),
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
