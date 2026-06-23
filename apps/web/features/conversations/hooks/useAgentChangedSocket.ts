'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket } from '@/shared/realtime';
import type { ConversationAgentChangedPayload } from '@hm/shared';
import { conversationAgentKey, conversationDetailKey } from '../queries';

/**
 * Reflete a troca manual de agente (F34-S04) em tempo real no cockpit.
 *
 * **Usa o socket REATIVO do `useSocket()` (contexto), NÃO `window.__hmSocket`.**
 * Ler o global na montagem corria com o `SocketProvider` (efeitos React rodam
 * filho-antes-do-pai): o listener nunca era anexado e o efeito (sem `socket` no
 * dep) não re-rodava ao conectar. Com `socket` no dep, anexa assim que a conexão
 * existe — mesma correção de `useConversationSocket`.
 *
 * Quando o evento é da conversa aberta, invalida a query do agente + o detalhe
 * para o seletor refletir o novo agente sem reload, mesmo vindo de outro operador.
 * No-op sem socket / sem id (degrada para "sem live updates").
 */
export function useAgentChangedSocket(conversationId: string | undefined): void {
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket || !conversationId) return;

    const onAgentChanged = (p: ConversationAgentChangedPayload): void => {
      if (p.conversationId !== conversationId) return;
      void queryClient.invalidateQueries({ queryKey: conversationAgentKey(conversationId) });
      void queryClient.invalidateQueries({ queryKey: conversationDetailKey(conversationId) });
    };

    socket.on('conversation:agent_changed', onAgentChanged);
    return () => {
      socket.off('conversation:agent_changed', onAgentChanged);
    };
  }, [conversationId, queryClient, socket]);
}
