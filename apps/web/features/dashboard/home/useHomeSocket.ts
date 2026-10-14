'use client';

/**
 * Tempo real da Home. O servidor já emite `dashboard:metric_changed` quando um número
 * muda; aqui o evento invalida o resumo e a fila. Rajadas de eventos viram UMA
 * atualização a cada 3 s (`realtime-batch.ts`): o número chega, a API não é
 * inundada. Sem `if (role)`: o servidor só manda o evento à sala certa e o payload
 * refeito já vem recortado pelo papel.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket } from '@/shared/realtime';
import { todayKeys } from '@/features/today';
import { homeKeys } from './queries';
import { createInvalidationBatch } from './realtime-batch';

export function useHomeSocket(): { readonly connected: boolean } {
  const { socket, connected } = useSocket();
  const qc = useQueryClient();

  useEffect(() => {
    if (!socket) return;
    const batch = createInvalidationBatch(qc, [homeKeys.all, todayKeys.all]);
    socket.on('dashboard:metric_changed', batch.call);
    return () => {
      socket.off('dashboard:metric_changed', batch.call);
      batch.cancel();
    };
  }, [socket, qc]);

  return { connected };
}
