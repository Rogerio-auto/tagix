/**
 * Fetchers da API de uso/custo LLM do WORKSPACE (tenant-scoped). Reusa o `api`
 * tipado (cookie de sessão via proxy do Next). Backend gated por `agent.view_costs`
 * (403 → ApiError). Fonte única dos endpoints `/api/usage/*`.
 */
import { api } from '@/shared/lib/api-client';

export type UsageGroupBy = 'day' | 'model';

export interface UsageBucket {
  readonly key: string;
  readonly label: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly requests: number;
}

export interface UsageTotal {
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly requests: number;
}

export const workspaceUsage = {
  summary: (params: { from?: string; to?: string; groupBy: UsageGroupBy }) => {
    const q = new URLSearchParams();
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    q.set('groupBy', params.groupBy);
    return api.get<{ buckets: UsageBucket[] }>(`/api/usage/summary?${q.toString()}`);
  },
  totals: () => api.get<{ today: UsageTotal; month: UsageTotal }>('/api/usage/totals'),
};
