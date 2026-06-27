'use client';

/**
 * React Query da saúde da sincronização (F52-S09). Auto-refresh a cada 15s — é um
 * painel operacional vivo (fila represada / DLQ / canal degradado deve aparecer
 * rápido), mas sem polling agressivo.
 */
import { useQuery } from '@tanstack/react-query';
import { monitoring } from './client';

export function useSyncHealth() {
  return useQuery({
    queryKey: ['monitoring', 'sync-health'],
    queryFn: () => monitoring.syncHealth(),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}
