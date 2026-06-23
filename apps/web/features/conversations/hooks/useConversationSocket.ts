'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket } from '@/shared/realtime';
import type {
  ConversationUpdatedPayload,
  MessageNewPayload,
} from '@hm/shared';
import { conversationAgentKey, conversationDetailKey } from '../queries';

/**
 * Assinatura mínima do cliente Socket.io publicada como global. O
 * `SocketProvider` injeta a instância real em `window.__hmSocket`. Mantida aqui
 * só para a declaração de tipo do global — todos os hooks de LiveChat consomem o
 * socket REATIVO via `useSocket()` (sem a corrida filho-antes-do-pai), NÃO este
 * global. O global permanece declarado para compat com consumidores de outras
 * features que ainda o leem.
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

/**
 * Mantém o DETALHE da conversa aberta vivo (status / aiMode / assignee /
 * department) — alimenta o Header e o Cockpit (`ContactInfoPanel`), ambos
 * leitores de `['conversation', id, 'detail']`.
 *
 * A API emite estes eventos para a sala da conversa E para `ws:{workspaceId}`
 * (`apps/api/src/routes/conversations/{state,routing,messages}.ts`), mas até
 * aqui NENHUM listener os consumia → o Header/Cockpit ficavam stale quando OUTRO
 * operador (ou a própria IA, via human_takeover) mudava o estado. Este hook fecha
 * esse gap invalidando o detalhe (e a lista, já que badges de status/atribuição
 * mudam a projeção da ChatList). Filtra pela conversa aberta — o socket é
 * compartilhado, então ignora eventos de outras conversas.
 *
 * Usa o socket REATIVO (`useSocket`) com `socket` no dep array — mesmo motivo de
 * `useConversationSocket`: ler `window.__hmSocket` na montagem corria com o
 * provider e não registrava listener. No-op sem socket / sem id.
 */
export function useConversationDetailLive(conversationId: string | undefined): void {
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket || !conversationId) return;

    // Todos estes payloads carregam `conversationId` na raiz — narrow uniforme.
    const onDetailChanged = (p: { conversationId: string }): void => {
      if (p.conversationId !== conversationId) return;
      void queryClient.invalidateQueries({ queryKey: conversationDetailKey(conversationId) });
      // O agente atual também vive no detail e numa query própria (cockpit).
      void queryClient.invalidateQueries({ queryKey: conversationAgentKey(conversationId) });
      // Status/atribuição mudam badges e ordenação/visibilidade da lista.
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    };

    socket.on('conversation:state_changed', onDetailChanged);
    socket.on('conversation:ai_mode_changed', onDetailChanged);
    socket.on('conversation:assigned', onDetailChanged);
    socket.on('conversation:routing_changed', onDetailChanged);

    return () => {
      socket.off('conversation:state_changed', onDetailChanged);
      socket.off('conversation:ai_mode_changed', onDetailChanged);
      socket.off('conversation:assigned', onDetailChanged);
      socket.off('conversation:routing_changed', onDetailChanged);
    };
  }, [queryClient, socket, conversationId]);
}
