/**
 * Fetchers das APIs de plataforma (F25-S06) — client-side.
 *
 * Reusa o `api` tipado do app (cookie de sessão first-party via proxy do Next).
 * As páginas (S07/S08) importam daqui; backend é gated por `requirePlatformAdmin`
 * (S01) — o 403 vira `ApiError`. Fonte única dos endpoints `/platform/*`.
 */
import { api } from '@/shared/lib/api-client';
import type {
  CapAlert,
  LlmModel,
  ModelSyncResult,
  PlatformSecretMeta,
  TopSpender,
  UsageBucket,
  WorkspaceAgentPolicy,
  WorkspaceSummary,
} from './types';

export type UsageGroupBy = 'workspace' | 'model' | 'day';

// ─── Modelos (F25-S02) ──────────────────────────────────────────────────────
export const platformModels = {
  list: () => api.get<{ models: LlmModel[] }>('/api/platform/models'),
  patch: (
    id: string,
    body: Partial<Pick<LlmModel, 'isActive' | 'defaultPlanKeys' | 'notes'>>,
  ) => api.patch<{ model: LlmModel }>(`/api/platform/models/${id}`, body),
  sync: () => api.post<ModelSyncResult>('/api/platform/models/sync'),
};

// ─── Políticas (F25-S03) ────────────────────────────────────────────────────
export const platformPolicies = {
  workspaces: () => api.get<{ workspaces: WorkspaceSummary[] }>('/api/platform/workspaces'),
  get: (workspaceId: string) =>
    api.get<{ policy: WorkspaceAgentPolicy }>(
      `/api/platform/workspaces/${workspaceId}/agent-policy`,
    ),
  update: (workspaceId: string, body: Partial<WorkspaceAgentPolicy>) =>
    api.put<{ policy: WorkspaceAgentPolicy }>(
      `/api/platform/workspaces/${workspaceId}/agent-policy`,
      body,
    ),
};

// ─── Secrets (F25-S04) ──────────────────────────────────────────────────────
export const platformSecrets = {
  list: () => api.get<{ secrets: PlatformSecretMeta[] }>('/api/platform/secrets'),
  rotate: (key: string, value: string) =>
    api.put<{ secret: PlatformSecretMeta }>(`/api/platform/secrets/${key}`, { value }),
};

// ─── Uso (F25-S05) ──────────────────────────────────────────────────────────
export const platformUsage = {
  summary: (params: { from?: string; to?: string; groupBy: UsageGroupBy }) => {
    const q = new URLSearchParams();
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    q.set('groupBy', params.groupBy);
    return api.get<{ buckets: UsageBucket[] }>(`/api/platform/usage/summary?${q.toString()}`);
  },
  topSpenders: (period: 'month' = 'month') =>
    api.get<{ spenders: TopSpender[] }>(`/api/platform/usage/top-spenders?period=${period}`),
  capAlerts: () => api.get<{ alerts: CapAlert[] }>('/api/platform/usage/cap-alerts'),
};
