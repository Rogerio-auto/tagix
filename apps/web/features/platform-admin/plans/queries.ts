'use client';

/**
 * Tipos + React Query do catalogo de Planos (F26-S08) sobre a API F26-S03.
 * As chaves tipadas de limits/features espelham o contrato do backend (plans.ts).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

export const LIMIT_KEYS = [
  'max_agents',
  'max_channels',
  'max_members',
  'max_monthly_messages',
  'max_flows',
  'max_knowledge_documents',
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export const FEATURE_KEYS = [
  'instagram',
  'flows',
  'api_access',
  'campaigns',
  'calendar',
  'knowledge_base',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface Plan {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceMonthlyCents: number;
  readonly priceYearlyCents: number;
  readonly limits: Partial<Record<LimitKey, number>>;
  readonly features: Partial<Record<FeatureKey, boolean>>;
  readonly isActive: boolean;
  readonly position: number;
  readonly createdAt: string;
}

export interface PlanInput {
  key: string;
  name: string;
  description?: string | null;
  priceMonthlyCents?: number;
  priceYearlyCents?: number;
  limits?: Partial<Record<LimitKey, number>>;
  features?: Partial<Record<FeatureKey, boolean>>;
  isActive?: boolean;
  position?: number;
}

export function usePlans() {
  return useQuery({
    queryKey: ['platform', 'plans'],
    queryFn: () => api.get<{ plans: Plan[] }>('/api/platform/plans'),
  });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PlanInput) => api.post<{ plan: Plan }>('/api/platform/plans', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'plans'] }),
  });
}

export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<PlanInput> }) =>
      api.patch<{ plan: Plan }>(`/api/platform/plans/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'plans'] }),
  });
}

export function useDeactivatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ plan: Plan }>(`/api/platform/plans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'plans'] }),
  });
}
