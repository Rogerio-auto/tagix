'use client';

/**
 * React Query + tipos do billing portal self-serve (F41-S06) sobre a API F41-S04.
 *
 * Contratos espelham EXATAMENTE `apps/api/src/routes/billing/index.ts`:
 *   POST /api/billing/checkout      → { redirectUrl }   (billing.change_plan, OWNER)
 *   GET  /api/billing/subscription  → { subscription, history }   (billing.view)
 *   POST /api/billing/cancel        → { canceled, method, effective }
 *
 * SEAM (catálogo de planos): a API F41-S04 NÃO expõe um endpoint de planos
 * voltado ao tenant — `/api/platform/plans` é gated por platform-admin. Tentamos
 * `/api/billing/plans` (endpoint natural que a S04 deve expor); na ausência dele
 * o portal degrada com estado honesto (sem inventar planos no cliente).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/lib/api-client';

export type BillingCycle = 'monthly' | 'yearly';
export type PaymentMethod = 'card' | 'pix';

/** Status reusado do billing interno (workspaces.subscription_status). */
export type SubscriptionStatus =
  | 'trial'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | string;

export interface BillingPlan {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly priceMonthlyCents: number;
  readonly priceYearlyCents: number;
}

export interface SubscriptionPlan {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly priceMonthlyCents: number;
  readonly priceYearlyCents: number;
}

export interface CurrentSubscription {
  readonly status: SubscriptionStatus;
  readonly billingCycle: BillingCycle | string;
  readonly paymentProvider: string | null;
  readonly paymentMethod: PaymentMethod | null;
  readonly currentPeriodStart: string | null;
  readonly currentPeriodEnd: string | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly canceledAt: string | null;
  readonly plan: SubscriptionPlan | null;
}

export interface PaymentEvent {
  readonly id: string;
  readonly eventType: string;
  readonly status: string;
  readonly amountCents: number | null;
  readonly receivedAt: string;
  readonly processedAt: string | null;
}

export interface SubscriptionResponse {
  readonly subscription: CurrentSubscription | null;
  readonly history: readonly PaymentEvent[];
}

export interface CheckoutInput {
  readonly planId: string;
  readonly cycle: BillingCycle;
  readonly method: PaymentMethod;
}

export const BILLING_KEYS = {
  subscription: ['billing', 'subscription'] as const,
  plans: ['billing', 'plans'] as const,
};

export function useBillingSubscription() {
  return useQuery({
    queryKey: BILLING_KEYS.subscription,
    queryFn: () => api.get<SubscriptionResponse>('/api/billing/subscription'),
  });
}

/**
 * Catálogo de planos voltado ao tenant. Endpoint não garantido pela S04 (seam):
 * 404/401 vira lista vazia (degradação honesta), não erro de tela.
 */
export function useBillingPlans() {
  return useQuery({
    queryKey: BILLING_KEYS.plans,
    queryFn: async (): Promise<readonly BillingPlan[]> => {
      try {
        const res = await api.get<{ plans: BillingPlan[] }>('/api/billing/plans');
        return res.plans;
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 401 || err.status === 403)) {
          return [];
        }
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useStartCheckout() {
  return useMutation({
    mutationFn: (input: CheckoutInput) =>
      api.post<{ redirectUrl: string }>('/api/billing/checkout', input),
  });
}

export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ canceled: boolean; method: string; effective: string }>('/api/billing/cancel'),
    onSuccess: () => qc.invalidateQueries({ queryKey: BILLING_KEYS.subscription }),
  });
}
