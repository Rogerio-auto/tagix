'use client';

/**
 * React Query hooks do uso/custo LLM do workspace, sobre `/api/usage/*`.
 */
import { useQuery } from '@tanstack/react-query';
import { workspaceUsage, type UsageGroupBy } from './client';

export function useWorkspaceUsageSummary(groupBy: UsageGroupBy, from: string) {
  return useQuery({
    queryKey: ['usage', 'summary', groupBy, from],
    queryFn: () => workspaceUsage.summary({ groupBy, from }),
  });
}

export function useWorkspaceUsageTotals() {
  return useQuery({
    queryKey: ['usage', 'totals'],
    queryFn: () => workspaceUsage.totals(),
  });
}
