'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Real-time do inbox de suporte da plataforma (F38-S11 / S08). O platform-admin
 * ja entra em `support:platform` no handshake (servidor), entao a fila inteira
 * recebe support:message/support:thread_updated; tambem juntamos ao room do
 * thread aberto para o detalhe. Invalida as queries (servidor autoritativo).
 * Le window.__hmSocket por uma fatia minima; no-op sem socket.
 */
interface SocketSlice {
  emit(event: string, ...args: unknown[]): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
}

function resolveSocket(): SocketSlice | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.__hmSocket as unknown as SocketSlice | undefined;
}

export function usePlatformSupportSocket(openThreadId: string | null): void {
  const qc = useQueryClient();

  useEffect(() => {
    const socket = resolveSocket();
    if (!socket) return;

    const refresh = (): void => {
      void qc.invalidateQueries({ queryKey: ['platform', 'support'] });
    };

    const joinThread = (): void => {
      if (openThreadId) socket.emit('support:thread:join', openThreadId);
    };
    joinThread();

    socket.on('support:message', refresh);
    socket.on('support:thread_updated', refresh);
    socket.on('connect', joinThread);

    return () => {
      if (openThreadId) socket.emit('support:thread:leave', openThreadId);
      socket.off('support:message', refresh);
      socket.off('support:thread_updated', refresh);
      socket.off('connect', joinThread);
    };
  }, [openThreadId, qc]);
}
