'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ConversationUpdatedPayload,
  MessageNewPayload,
} from '@hm/shared';

/**
 * Assinatura mínima de um cliente Socket.io (Server→Client) que a ChatList
 * precisa. Tipada contra o mapa de eventos de `@hm/shared` — sem acoplar a
 * `socket.io-client` (que ainda não é dependência de @hm/web).
 *
 * O orquestrador injeta a instância real em `window.__hmSocket` quando o
 * provider de socket for montado (slot de infra de real-time). Enquanto não
 * existir, a ChatList degrada graciosamente para "sem live updates" — sem
 * quebrar typecheck/build.
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

function resolveSocket(): ConversationSocket | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.__hmSocket;
}

/**
 * Mantém a lista de conversas viva em tempo real (LIVECHAT.md §6).
 *
 * Escuta `conversation:updated` e `message:new` no socket compartilhado e
 * invalida a query `['conversations']` para que o TanStack Query rebusque a
 * ordenação/contadores de não-lidas autoritativos do backend. Invalidar (em vez
 * de fazer patch otimista do payload `unknown`) é a opção correta: o payload do
 * evento é `unknown` no boundary e a ordenação/agregação de não-lidas é
 * responsabilidade do servidor.
 *
 * Sem socket injetado, é um no-op silencioso.
 */
export function useConversationSocket(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = resolveSocket();
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
  }, [queryClient]);
}

/**
 * Mantém a THREAD aberta viva em tempo real: ao chegar `message:new` da conversa
 * atual, invalida `['conversation', id, 'messages']` para o TanStack Query
 * rebuscar (a `useConversationSocket` acima só cuida da LISTA). Sem isto, uma
 * resposta nova só aparecia após refresh manual. No-op sem socket / sem id.
 */
export function useConversationMessagesLive(conversationId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = resolveSocket();
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
  }, [queryClient, conversationId]);
}
