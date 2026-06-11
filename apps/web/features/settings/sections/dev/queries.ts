'use client';

/**
 * React Query hooks da seção Settings → Dev (F9-S06). Consome as rotas de gestão
 * session-authed da F9-S04 (`/api/dev/*`). O token claro da chave e o segredo do
 * webhook só vêm na resposta de criação (show-once) — nunca em listagens.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

// ─── Tipos ──────────────────────────────────────────────────────────────────
export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  rateLimitPerMinute: number;
  isActive: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface CreateApiKeyInput {
  name: string;
  scopes: string[];
  rateLimitPerMinute?: number;
}

export interface OutboundWebhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  status: 'pending' | 'sent' | 'failed' | 'retrying';
  responseStatus: number | null;
  attempt: number;
  nextAttemptAt: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface CreateWebhookInput {
  name: string;
  url: string;
  events: string[];
  secret?: string;
}

export const devKeys = {
  apiKeys: ['dev', 'api-keys'] as const,
  webhooks: ['dev', 'webhooks'] as const,
  deliveries: (id: string) => ['dev', 'webhooks', id, 'deliveries'] as const,
};

// ─── API keys ─────────────────────────────────────────────────────────────────
export function useApiKeys() {
  return useQuery({
    queryKey: devKeys.apiKeys,
    queryFn: () => api.get<{ apiKeys: ApiKey[] }>('/api/dev/api-keys'),
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation<{ apiKey: ApiKey; token: string }, Error, CreateApiKeyInput>({
    mutationFn: (input) => api.post<{ apiKey: ApiKey; token: string }>('/api/dev/api-keys', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: devKeys.apiKeys }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation<{ apiKey: ApiKey }, Error, string>({
    mutationFn: (id) => api.post<{ apiKey: ApiKey }>(`/api/dev/api-keys/${id}/revoke`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: devKeys.apiKeys }),
  });
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────
export function useWebhooks() {
  return useQuery({
    queryKey: devKeys.webhooks,
    queryFn: () =>
      api.get<{ webhooks: OutboundWebhook[]; availableEvents: string[] }>('/api/dev/webhooks'),
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation<{ webhook: OutboundWebhook; secret: string }, Error, CreateWebhookInput>({
    mutationFn: (input) =>
      api.post<{ webhook: OutboundWebhook; secret: string }>('/api/dev/webhooks', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: devKeys.webhooks }),
  });
}

export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation<
    { webhook: OutboundWebhook },
    Error,
    { id: string; name?: string; url?: string; events?: string[]; isActive?: boolean }
  >({
    mutationFn: ({ id, ...patch }) =>
      api.patch<{ webhook: OutboundWebhook }>(`/api/dev/webhooks/${id}`, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: devKeys.webhooks }),
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete<void>(`/api/dev/webhooks/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: devKeys.webhooks }),
  });
}

export function useTestWebhook() {
  return useMutation<{ delivered: boolean; status?: number; error?: string }, Error, string>({
    mutationFn: (id) =>
      api.post<{ delivered: boolean; status?: number; error?: string }>(
        `/api/dev/webhooks/${id}/test`,
      ),
  });
}

export function useWebhookDeliveries(id: string | null) {
  return useQuery({
    queryKey: id ? devKeys.deliveries(id) : ['dev', 'webhooks', 'none', 'deliveries'],
    queryFn: () => api.get<{ deliveries: WebhookDelivery[] }>(`/api/dev/webhooks/${id}/deliveries`),
    enabled: id !== null,
  });
}
