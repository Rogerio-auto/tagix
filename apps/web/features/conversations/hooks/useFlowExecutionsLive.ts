'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket } from '@/shared/realtime';
import type { FlowExecutionUpdatedPayload } from '@hm/shared';

/**
 * Mantém a seção "Execuções Ativas" do cockpit viva em tempo real (F51). Escuta
 * `flow_execution:updated` e invalida a query de execuções da conversa — o caminho primário do
 * monitoramento (o `refetchInterval` da query é só fallback).
 *
 * Espelha `useConversationDetailLive`: usa o socket REATIVO (`useSocket`) com `socket` no dep
 * array (os efeitos rodam filho-antes-do-pai; sem isto o listener não era registrado ao conectar).
 * Filtra pela conversa aberta — o socket é compartilhado. No-op sem socket / sem id.
 */
export function useFlowExecutionsLive(conversationId: string | undefined): void {
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket || !conversationId) return;

    const onChanged = (p: FlowExecutionUpdatedPayload): void => {
      if (p.conversationId !== conversationId) return;
      void queryClient.invalidateQueries({
        queryKey: ['flow-executions', 'conversation', conversationId],
      });
    };

    socket.on('flow_execution:updated', onChanged);
    return () => {
      socket.off('flow_execution:updated', onChanged);
    };
  }, [queryClient, socket, conversationId]);
}
