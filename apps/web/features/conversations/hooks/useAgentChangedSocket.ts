'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ConversationAgentChangedPayload } from '@hm/shared';
import { conversationAgentKey, conversationDetailKey } from '../queries';

/**
 * Reflete a troca manual de agente (F34-S04) em tempo real no cockpit.
 *
 * Escuta `conversation:agent_changed` no socket compartilhado (`window.__hmSocket`,
 * injetado pelo provider de real-time) e, quando o evento é da conversa aberta,
 * invalida a query do agente + o detalhe — para que o seletor reflita o novo
 * agente sem reload, mesmo quando a troca veio de outro operador.
 *
 * Sem socket injetado, é um no-op silencioso (degrada para "sem live updates").
 */
interface AgentChangedSocket {
  on(
    event: 'conversation:agent_changed',
    listener: (p: ConversationAgentChangedPayload) => void,
  ): unknown;
  off(
    event: 'conversation:agent_changed',
    listener: (p: ConversationAgentChangedPayload) => void,
  ): unknown;
}

function resolveSocket(): AgentChangedSocket | undefined {
  if (typeof window === 'undefined') return undefined;
  // O socket compartilhado expõe o mapa tipado de ServerToClient; reusamos só
  // o subconjunto que este hook precisa (evita acoplar a socket.io-client).
  return window.__hmSocket as unknown as AgentChangedSocket | undefined;
}

export function useAgentChangedSocket(conversationId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!conversationId) return;
    const socket = resolveSocket();
    if (!socket) return;

    const onAgentChanged = (p: ConversationAgentChangedPayload): void => {
      if (p.conversationId !== conversationId) return;
      void queryClient.invalidateQueries({ queryKey: conversationAgentKey(conversationId) });
      void queryClient.invalidateQueries({ queryKey: conversationDetailKey(conversationId) });
    };

    socket.on('conversation:agent_changed', onAgentChanged);
    return () => {
      socket.off('conversation:agent_changed', onAgentChanged);
    };
  }, [conversationId, queryClient]);
}
