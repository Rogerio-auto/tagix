'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

export interface DashboardConfig {
  requiredByRole: Record<string, string[]>;
  alertLimits: {
    slaViolationCount: number | null;
    llmCostUsdDaily: number | null;
  };
}

export interface DashboardConfigResponse {
  config: DashboardConfig;
  /** Catálogo de métricas visíveis por role, p/ montar os checkboxes. */
  catalog: Record<string, string[]>;
}

export const dashboardConfigKeys = {
  config: ['dashboard', 'config'] as const,
};

export function useDashboardConfig(enabled = true) {
  return useQuery({
    queryKey: dashboardConfigKeys.config,
    queryFn: () => api.get<DashboardConfigResponse>('/api/dashboard/config'),
    enabled,
    retry: false,
  });
}

export function useUpdateDashboardConfig() {
  const qc = useQueryClient();
  return useMutation<{ config: DashboardConfig }, Error, Partial<DashboardConfig>>({
    mutationFn: (patch) => api.put<{ config: DashboardConfig }>('/api/dashboard/config', patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dashboardConfigKeys.config }),
  });
}
