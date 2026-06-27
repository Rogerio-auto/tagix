/**
 * Fetcher da saúde da sincronização (F52-S09), sobre `GET /api/monitoring/sync-health`.
 * Backend gated por OWNER/ADMIN ou platform-admin (403 → ApiError). Reusa o `api`
 * tipado (cookie de sessão via proxy do Next).
 */
import { api } from '@/shared/lib/api-client';

export type ChannelHealthStatus =
  | 'connected'
  | 'warning'
  | 'degraded'
  | 'inactive'
  | 'unlinked';

export interface QueueView {
  readonly name: string;
  readonly messages: number;
  readonly ready: number;
  readonly unacked: number;
  readonly consumers: number;
}

export interface ChannelHealth {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly phoneNumber: string | null;
  readonly isActive: boolean;
  readonly hasToken: boolean;
  readonly qualityRating: string | null;
  readonly status: ChannelHealthStatus;
}

export interface SyncHealth {
  readonly generatedAt: string;
  readonly mq: { readonly reachable: boolean; readonly error?: string };
  readonly queues: readonly QueueView[];
  readonly dlq: { readonly name: string; readonly messages: number };
  readonly retryInFlight: number;
  readonly pending: { readonly messages: number; readonly mediaFailed: number };
  readonly channels: readonly ChannelHealth[];
}

export const monitoring = {
  syncHealth: () => api.get<SyncHealth>('/api/monitoring/sync-health'),
};
