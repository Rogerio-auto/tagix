'use client';

/**
 * React Query hooks do dashboard de custo (F25-S08) sobre a API F25-S05.
 */
import { useQuery } from '@tanstack/react-query';
import { platformUsage, type UsageGroupBy } from '@/features/platform-admin/lib';

export function useUsageSummary(groupBy: UsageGroupBy) {
  return useQuery({
    queryKey: ['platform', 'usage', 'summary', groupBy],
    queryFn: () => platformUsage.summary({ groupBy }),
  });
}

export function useTopSpenders() {
  return useQuery({
    queryKey: ['platform', 'usage', 'top-spenders'],
    queryFn: () => platformUsage.topSpenders('month'),
  });
}

export function useCapAlerts() {
  return useQuery({
    queryKey: ['platform', 'usage', 'cap-alerts'],
    queryFn: () => platformUsage.capAlerts(),
  });
}
