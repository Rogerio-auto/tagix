'use client';

/**
 * Realtime do dashboard (F8-S03 / DASHBOARD.md §5/§8). Escuta
 * `dashboard:metric_changed` e invalida a query do dashboard para refetch.
 *
 * A filtragem por role é server-side: o servidor só envia o evento à room do
 * workspace e o front reage apenas se a métrica estiver no conjunto atual de cards
 * (que já veio filtrado). Por isso não há `if(role)` aqui — apenas checamos se a
 * métrica mudada pertence ao dashboard renderizado.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DashboardMetricChangedPayload } from '@hm/shared';
import { useSocket } from '@/shared/realtime';
import { dashboardKeys } from './queries';

export function useDashboardSocket(visibleMetricKeys: ReadonlySet<string>): void {
  const { socket } = useSocket();
  const qc = useQueryClient();

  useEffect(() => {
    if (!socket) return;
    const onChanged = (p: DashboardMetricChangedPayload): void => {
      // Só refetch se a métrica está no dashboard atual (server-driven: o conjunto
      // de cards já reflete o role; não inferimos visibilidade aqui).
      if (visibleMetricKeys.has(p.metricKey)) {
        void qc.invalidateQueries({ queryKey: dashboardKeys.me });
      }
    };
    socket.on('dashboard:metric_changed', onChanged);
    return () => {
      socket.off('dashboard:metric_changed', onChanged);
    };
  }, [socket, qc, visibleMetricKeys]);
}
