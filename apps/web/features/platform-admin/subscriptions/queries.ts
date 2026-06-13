'use client';

/**
 * Tipos + React Query da Assinatura por tenant (F26-S08) sobre a API F26-S04.
 * Mostra os entitlements EFETIVOS resolvidos (override > plano).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { FeatureKey, LimitKey, Plan } from '../plans/queries';

export interface EffectiveEntitlements {
  readonly workspaceId: string;
  readonly planId: string | null;
  readonly planKey: string | null;
  readonly planName: string | null;
  readonly limits: Partial<Record<LimitKey, number>>;
  readonly features: Partial<Record<FeatureKey, boolean>>;
  readonly planLimits: Partial<Record<LimitKey, number>>;
  readonly planFeatures: Partial<Record<FeatureKey, boolean>>;
  readonly overrideLimits: Partial<Record<LimitKey, number>>;
  readonly overrideFeatures: Partial<Record<FeatureKey, boolean>>;
}

export interface SubscriptionView {
  readonly workspaceId: string;
  readonly planId: string | null;
  readonly status: string;
  readonly trialEndsAt: string | null;
  readonly billingCycle: string;
  readonly entitlements: EffectiveEntitlements;
}

export interface SubscriptionUpdate {
  planId?: string | null;
  status?: string;
  billingCycle?: string;
  trialEndsAt?: string | null;
}

export interface OverrideUpdate {
  limits: Partial<Record<LimitKey, number>>;
  features: Partial<Record<FeatureKey, boolean>>;
}

export function useTenantSelector() {
  return useQuery({
    queryKey: ['platform', 'tenants', 'selector'],
    queryFn: () =>
      api.get<{ tenants: { id: string; name: string; slug: string }[] }>(
        '/api/platform/tenants?limit=100',
      ),
  });
}

export function useSubscription(workspaceId: string) {
  return useQuery({
    queryKey: ['platform', 'subscription', workspaceId],
    queryFn: () => api.get<SubscriptionView>(`/api/platform/tenants/${workspaceId}/subscription`),
    enabled: Boolean(workspaceId),
  });
}

export function usePlansForSelect() {
  return useQuery({
    queryKey: ['platform', 'plans'],
    queryFn: () => api.get<{ plans: Plan[] }>('/api/platform/plans'),
  });
}

export function useUpdateSubscription(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubscriptionUpdate) =>
      api.put<SubscriptionView>(`/api/platform/tenants/${workspaceId}/subscription`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'subscription', workspaceId] }),
  });
}

export function useUpdateOverrides(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OverrideUpdate) =>
      api.put<{ workspaceId: string; entitlements: EffectiveEntitlements }>(
        `/api/platform/tenants/${workspaceId}/entitlement-overrides`,
        input,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'subscription', workspaceId] }),
  });
}
