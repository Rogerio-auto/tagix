'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Mantem o chat de suporte vivo em tempo real (F38-S09 / S08). Junta-se ao room
 * `support:thread:<id>` do thread aberto e escuta `support:message` /
 * `support:thread_updated`, invalidando as queries para rebuscar do servidor
 * (fonte autoritativa de ordenacao/status). Reconexao: o socket.io reconecta
 * sozinho; ao reconectar, re-emitimos o join. Sem socket injetado -> no-op.
 *
 * Le `window.__hmSocket` por uma fatia minima (emit/on/off), mesmo padrao
 * transport-agnostic dos hooks de conversas — sem acoplar a socket.io-client
 * nem redeclarar o global (que ja existe como ConversationSocket).
 */
interface SupportSocketSlice {
  connected?: boolean;
  emit(event: string, ...args: unknown[]): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
}

function resolveSocket(): SupportSocketSlice | undefined {
  if (typeof window === 'undefined') return undefined;
  const s = window.__hmSocket as unknown as SupportSocketSlice | undefined;
  return s;
}

export function useSupportSocket(threadId: string | null): void {
  const qc = useQueryClient();

  useEffect(() => {
    const socket = resolveSocket();
    if (!socket || !threadId) return;

    const join = (): void => {
      socket.emit('support:thread:join', threadId);
    };
    join();

    const onMessage = (): void => {
      void qc.invalidateQueries({ queryKey: ['support', 'thread', threadId] });
      void qc.invalidateQueries({ queryKey: ['support', 'threads'] });
    };
    const onThreadUpdated = (): void => {
      void qc.invalidateQueries({ queryKey: ['support', 'thread', threadId] });
      void qc.invalidateQueries({ queryKey: ['support', 'threads'] });
    };

    socket.on('support:message', onMessage);
    socket.on('support:thread_updated', onThreadUpdated);
    // Re-join ao reconectar (o servidor recria as rooms num socket novo).
    socket.on('connect', join);

    return () => {
      socket.emit('support:thread:leave', threadId);
      socket.off('support:message', onMessage);
      socket.off('support:thread_updated', onThreadUpdated);
      socket.off('connect', join);
    };
  }, [threadId, qc]);
}
