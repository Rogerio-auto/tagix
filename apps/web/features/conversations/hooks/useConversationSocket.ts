'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket } from '@/shared/realtime';
import { api } from '@/shared/lib/api-client';
import type {
  ConversationUpdatedPayload,
  MessageMediaFailedPayload,
  MessageMediaReadyPayload,
  MessageNewPayload,
} from '@hm/shared';
import { conversationAgentKey, conversationDetailKey, messagesKey } from '../queries';
import { resyncConversationData } from './realtimeResync';
import { markMediaFailed, type MessagesPage } from './messageCache';

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
    // Resync ao (re)conectar: eventos perdidos enquanto offline (nova conversa,
    // mudança de ordenação/contadores) somem; rebuscar a lista fecha o gap.
    const onConnect = (): void => resyncConversationData(queryClient, undefined);

    socket.on('conversation:updated', onConversationUpdated);
    socket.on('message:new', onMessageNew);
    socket.on('connect', onConnect);

    return () => {
      socket.off('conversation:updated', onConversationUpdated);
      socket.off('message:new', onMessageNew);
      socket.off('connect', onConnect);
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

    const invalidateMessages = (): void => {
      void queryClient.invalidateQueries({
        queryKey: ['conversation', conversationId, 'messages'],
      });
    };

    const onMessageNew = (p: MessageNewPayload): void => {
      if (p.conversationId === conversationId) invalidateMessages();
    };
    // Mídia (áudio/imagem/etc.) baixada de forma assíncrona pelo media-worker:
    // ao terminar, ele emite `message:media_ready` → rebusca para o player aparecer
    // sem reload (antes a mensagem ficava presa em "carregando áudio" no cache).
    const onMediaReady = (p: MessageMediaReadyPayload): void => {
      if (p.conversationId === conversationId) invalidateMessages();
    };
    // Falha definitiva no download da mídia (F52-S05): em vez de deixar a bolha
    // presa em "carregando…", marca-a localmente como falha (patch determinístico,
    // sem refetch) → a UI mostra erro acionável + "Tentar novamente".
    const onMediaFailed = (p: MessageMediaFailedPayload): void => {
      if (p.conversationId !== conversationId) return;
      const key = messagesKey(conversationId);
      queryClient.setQueryData(
        key,
        markMediaFailed(queryClient.getQueryData<MessagesPage>(key), p.messageId),
      );
    };
    // Resync ao (re)conectar: rebusca mensagens + detalhe + lista desta conversa
    // (fecha o gap de eventos perdidos offline). Idempotente entre hooks no tick.
    const onConnect = (): void => resyncConversationData(queryClient, conversationId);

    socket.on('message:new', onMessageNew);
    socket.on('message:media_ready', onMediaReady);
    socket.on('message:media_failed', onMediaFailed);
    socket.on('connect', onConnect);
    return () => {
      socket.off('message:new', onMessageNew);
      socket.off('message:media_ready', onMediaReady);
      socket.off('message:media_failed', onMediaFailed);
      socket.off('connect', onConnect);
    };
  }, [queryClient, socket, conversationId]);
}

/**
 * Marca a conversa como LIDA: zera o contador de não-lidas ao ABRIR e a cada
 * `message:new` que chega enquanto ela está aberta. POST /api/conversations/:id/read
 * (o worker de inbound só incrementa; sem isto o badge nunca limpava) + invalida a
 * lista para o badge sumir na hora. Best-effort: falha não quebra a thread. No-op
 * sem id. Usa o socket REATIVO (mesmo motivo dos demais hooks).
 */
export function useMarkConversationRead(conversationId: string | undefined): void {
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  useEffect(() => {
    if (!conversationId) return;

    const markRead = (): void => {
      void api
        .post<{ ok: true }>(`/api/conversations/${conversationId}/read`, {})
        .then(() => queryClient.invalidateQueries({ queryKey: ['conversations'] }))
        .catch(() => {
          /* marcar lida é best-effort; nunca derruba a conversa */
        });
    };

    markRead(); // ao abrir a conversa

    if (!socket) return;
    const onMessageNew = (p: MessageNewPayload): void => {
      if (p.conversationId === conversationId) markRead(); // msg nova com a conversa aberta
    };
    socket.on('message:new', onMessageNew);
    return () => {
      socket.off('message:new', onMessageNew);
    };
  }, [conversationId, socket, queryClient]);
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
