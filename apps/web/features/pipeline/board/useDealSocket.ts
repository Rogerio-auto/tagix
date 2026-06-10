'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { pipelineKeys } from './queries';

/**
 * Reconciliação real-time do kanban (F5-S09 ⟵ F5-S07). Escuta os eventos
 * `deal:*`/`pipeline:updated` no socket compartilhado (`window.__hmSocket`) e
 * invalida a query de deals do pipeline — o optimistic update local é confirmado
 * (ou corrigido) pelo estado autoritativo do servidor. Sem socket, no-op.
 */
interface DealSocket {
  on(event: string, listener: (p: unknown) => void): unknown;
  off(event: string, listener: (p: unknown) => void): unknown;
}

function resolveSocket(): DealSocket | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { __hmSocket?: DealSocket }).__hmSocket;
}

const DEAL_EVENTS = [
  'deal:created',
  'deal:updated',
  'deal:stage_changed',
  'deal:deleted',
  'pipeline:updated',
] as const;

export function useDealSocket(pipelineId: string | undefined): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!pipelineId) return;
    const socket = resolveSocket();
    if (!socket) return;

    const invalidate = (): void => {
      void qc.invalidateQueries({ queryKey: pipelineKeys.deals(pipelineId) });
    };
    for (const ev of DEAL_EVENTS) socket.on(ev, invalidate);
    return () => {
      for (const ev of DEAL_EVENTS) socket.off(ev, invalidate);
    };
  }, [qc, pipelineId]);
}
