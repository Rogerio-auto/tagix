'use client';

/**
 * Tipos + React Query hooks do hub de Tenants (F26-S07) sobre a API F26-S02.
 * Fetchers chamam o `api` tipado direto (cookie de sessao via proxy do Next) -- a
 * lib/ do F25 e read-only para este slot, entao definimos os contratos aqui.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

export interface TenantListItem {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly subscriptionStatus: string;
  readonly trialEndsAt: string | null;
  readonly planKey: string | null;
  readonly planName: string | null;
  readonly memberCount: number;
  readonly monthCostUsd: number;
  readonly createdAt: string;
}

export interface TenantListResponse {
  readonly tenants: readonly TenantListItem[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface Workspace360 {
  readonly summary: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly industry: string | null;
    readonly subscriptionStatus: string;
    readonly trialEndsAt: string | null;
    readonly createdAt: string;
    readonly planKey: string | null;
    readonly planName: string | null;
    readonly owner: { readonly id: string; readonly name: string | null; readonly email: string } | null;
  };
  readonly usage: {
    readonly monthCostUsd: number;
    readonly monthTokens: number;
    readonly capUsd: number | null;
    readonly pctOfCap: number | null;
  };
  readonly members: readonly {
    readonly id: string;
    readonly name: string | null;
    readonly email: string;
    readonly role: string;
    readonly lastSeenAt: string | null;
  }[];
  readonly channels: readonly {
    readonly id: string;
    readonly provider: string;
    readonly name: string;
    readonly isActive: boolean;
  }[];
  readonly agents: readonly {
    readonly id: string;
    readonly name: string;
    readonly model: string;
    readonly status: string;
  }[];
  readonly health: {
    readonly failedWebhookDeliveries: number;
    readonly openConversations: number;
    readonly openDeals: number;
    readonly capExceeded: boolean;
    readonly trialExpired: boolean;
  };
  readonly recentAudit: readonly {
    readonly id: string;
    readonly action: string;
    readonly resourceType: string;
    readonly actorType: string;
    readonly createdAt: string;
  }[];
}

export interface TenantFilters {
  readonly search?: string;
  readonly status?: string;
  readonly limit: number;
  readonly offset: number;
}

export function useTenants(filters: TenantFilters) {
  return useQuery({
    queryKey: ['platform', 'tenants', filters],
    queryFn: () => {
      const q = new URLSearchParams();
      if (filters.search) q.set('search', filters.search);
      if (filters.status) q.set('status', filters.status);
      q.set('limit', String(filters.limit));
      q.set('offset', String(filters.offset));
      return api.get<TenantListResponse>(`/api/platform/tenants?${q.toString()}`);
    },
  });
}

export function useWorkspace360(id: string) {
  return useQuery({
    queryKey: ['platform', 'tenant', id],
    queryFn: () => api.get<Workspace360>(`/api/platform/tenants/${id}`),
    enabled: Boolean(id),
  });
}
