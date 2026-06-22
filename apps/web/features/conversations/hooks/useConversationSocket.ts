'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket } from '@/shared/realtime';
import type {
  ConversationUpdatedPayload,
  MessageNewPayload,
} from '@hm/shared';

/**
 * Assinatura mínima do cliente Socket.io consumida por hooks "transport-agnostic"
 * (TypingIndicator, MessageBubble/status) que ainda leem `window.__hmSocket`
 * direto. Mantida aqui só para a declaração de tipo do global.
 */
export interface ConversationSocket {
  on(event: 'conversation:updated', listener: (p: ConversationUpdatedPayload) => void): unknown;
  on(event: 'message:new', listener: (p: MessageNewPayload) => void): unknown;
  off(event: 'conversation:updated', listener: (p: ConversationUpdatedPayload) => void): unknown;
  off(event: 'message:new', listener: (p: MessageNewPayload) => void): unknown;
}

declare global {
  interface Window {
    /** Instância de socket compartilhada, injetada pelo provider de real-time. */
    __hmSocket?: ConversationSocket;
  }
}

/**
 * Mantém a LISTA de conversas viva em tempo real (LIVECHAT.md §6).
 *
 * **Usa o socket REATIVO do `useSocket()` (contexto), NÃO `window.__hmSocket`.**
 * Os efeitos do React rodam filho-antes-do-pai, então ler o global direto rodava
 * ANTES do `SocketProvider` setá-lo → `socket` undefined → nenhum listener era
 * registrado, e o efeito (deps `[queryClient]`) nunca re-rodava ao conectar. Com
 * `socket` no dep, o listener é anexado assim que a conexão fica disponível.
 *
 * Escuta `conversation:updated` e `message:new` e invalida `['conversations']`
 * para o TanStack Query rebuscar a ordenação/contadores autoritativos.
 */
export function useConversationSocket(): void {
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) return;

    const invalidate = (): void => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    };

    const onConversationUpdated = (_p: ConversationUpdatedPayload): void => invalidate();
    const onMessageNew = (_p: MessageNewPayload): void => invalidate();

    socket.on('conversation:updated', onConversationUpdated);
    socket.on('message:new', onMessageNew);

    return () => {
      socket.off('conversation:updated', onConversationUpdated);
      socket.off('message:new', onMessageNew);
    };
  }, [queryClient, socket]);
}

/**
 * Mantém a THREAD aberta viva: ao chegar `message:new` da conversa atual,
 * invalida `['conversation', id, 'messages']` para rebuscar (a `useConversationSocket`
 * acima só cuida da LISTA). Mesmo motivo do socket reativo — sem isto uma resposta
 * nova só aparecia após refresh. No-op sem socket / sem id.
 */
export function useConversationMessagesLive(conversationId: string | undefined): void {
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket || !conversationId) return;

    const onMessageNew = (p: MessageNewPayload): void => {
      if (p.conversationId !== conversationId) return;
      void queryClient.invalidateQueries({
        queryKey: ['conversation', conversationId, 'messages'],
      });
    };

    socket.on('message:new', onMessageNew);
    return () => {
      socket.off('message:new', onMessageNew);
    };
  }, [queryClient, socket, conversationId]);
}
