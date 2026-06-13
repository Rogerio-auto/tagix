'use client';

/**
 * Queries do dashboard (F8-S03). `useDashboard` carrega `/dashboard/me` com
 * `refetchInterval` de 5min (DASHBOARD §9.2) — o realtime fino vem do socket
 * (useDashboardSocket invalida esta query). `useMetricDetail` busca o drill-down
 * sob demanda quando um card abre o drawer.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { DashboardLayoutPreferences, DashboardPayload, DrillDetail } from './types';

export const dashboardKeys = {
  me: ['dashboard', 'me'] as const,
  metric: (key: string) => ['dashboard', 'metric', key] as const,
  metricParam: (key: string, param: string) =>
    ['dashboard', 'metric', key, param] as const,
};

const REFETCH_MS = 5 * 60 * 1000;

export function useDashboard() {
  return useQuery({
    queryKey: dashboardKeys.me,
    queryFn: () => api.get<DashboardPayload>('/api/dashboard/me'),
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useMetricDetail(metricKey: string | null, param?: string | null) {
  return useQuery({
    queryKey:
      param != null
        ? dashboardKeys.metricParam(metricKey ?? '__none__', param)
        : dashboardKeys.metric(metricKey ?? '__none__'),
    enabled: metricKey !== null,
    queryFn: () => {
      const suffix = param != null ? `?param=${encodeURIComponent(param)}` : '';
      return api.get<DrillDetail>(`/api/dashboard/metrics/${metricKey}${suffix}`);
    },
  });
}

/**
 * Persiste o layout pessoal (esconder/reordenar cards — DASHBOARD §6). A rota
 * `PATCH /api/members/me/dashboard-layout` é entregue pelo S04; aqui o hook fica
 * pronto e otimista. Enquanto a rota não existe, a mutação é no-op silenciosa do
 * ponto de vista do usuário (cai no catch). S04 liga o endpoint.
 */
export function useUpdateDashboardLayout() {
  const qc = useQueryClient();
  return useMutation<void, Error, Partial<DashboardLayoutPreferences>>({
    mutationFn: (patch) => api.patch<void>('/api/members/me/dashboard-layout', patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashboardKeys.me });
    },
  });
}
