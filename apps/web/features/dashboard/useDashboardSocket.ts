'use client';

/**
 * Realtime do dashboard (F8-S03 / DASHBOARD.md §5/§8). Escuta
 * `dashboard:metric_changed` e invalida a query do dashboard para refetch.
 *
 * A filtragem por role é server-side: o servidor só envia o evento à room do
 * workspace e o front reage apenas se a métrica estiver no conjunto atual de cards
 * (que já veio filtrado). Por isso não há `if(role)` aqui — apenas checamos se a
 * métrica mudada pertence ao dashboard renderizado.
 *
 * Rajadas viram uma invalidação a cada 3 s (`metric-changed-listener.ts`); a pendente
 * é descartada na desmontagem.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DashboardMetricChangedPayload } from '@hm/shared';
import { useSocket } from '@/shared/realtime';
import { createMetricChangedListener } from './metric-changed-listener';
import { dashboardKeys } from './queries';

export function useDashboardSocket(visibleMetricKeys: ReadonlySet<string>): void {
  const { socket } = useSocket();
  const qc = useQueryClient();

  useEffect(() => {
    if (!socket) return;
    const listener = createMetricChangedListener(qc, dashboardKeys.me, visibleMetricKeys);
    const onChanged = (p: DashboardMetricChangedPayload): void => listener.onChanged(p);
    socket.on('dashboard:metric_changed', onChanged);
    return () => {
      socket.off('dashboard:metric_changed', onChanged);
      listener.cancel();
    };
  }, [socket, qc, visibleMetricKeys]);
}
