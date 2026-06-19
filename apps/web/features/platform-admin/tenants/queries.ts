'use client';

/**
 * Tipos + React Query hooks do hub de Tenants (F26-S07) sobre a API F26-S02.
 * Fetchers chamam o `api` tipado direto (cookie de sessao via proxy do Next) -- a
 * lib/ do F25 e read-only para este slot, entao definimos os contratos aqui.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

/* ── Cobrança assistida (F41-S08) — POST /billing/checkout (F41-S07) ───────────
 * Reusa o catálogo de planos da plataforma (`/api/platform/plans`, mesmo
 * endpoint gated por admin que a F26 já consome). O super-admin gera o link de
 * checkout real; quem transiciona o status é sempre o webhook HMAC (S03). */

/** Plano do catálogo de plataforma (subset consumido pelo seletor de cobrança). */
export interface BillingPlanOption {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly priceMonthlyCents: number;
  readonly priceYearlyCents: number;
  readonly isActive: boolean;
  readonly position: number;
}

export type BillingCycle = 'monthly' | 'yearly';
export type BillingMethod = 'card' | 'pix';

export interface CheckoutInput {
  readonly planId: string;
  readonly cycle: BillingCycle;
  readonly method: BillingMethod;
}

export interface CheckoutResult {
  readonly workspaceId: string;
  readonly planId: string;
  readonly cycle: BillingCycle;
  readonly method: BillingMethod;
  readonly amountCents: number;
  readonly redirectUrl: string;
}

/** Catálogo de planos da plataforma — reusa a query já existente (F26). */
export function useBillingPlans() {
  return useQuery({
    queryKey: ['platform', 'plans'],
    queryFn: () => api.get<{ plans: readonly BillingPlanOption[] }>('/api/platform/plans'),
  });
}

/** Códigos de erro de domínio que o endpoint do S07 pode devolver. */
export type CheckoutErrorCode =
  | 'plan_not_found'
  | 'workspace_not_found'
  | 'plan_not_billable'
  | 'no_billing_contact'
  | 'invalid_body'
  | 'unknown';

/** Erro tipado do checkout — carrega o `error` code do corpo (a api-client só lê `message`). */
export class CheckoutError extends Error {
  constructor(
    readonly status: number,
    readonly code: CheckoutErrorCode,
  ) {
    super(code);
    this.name = 'CheckoutError';
  }
}

const CHECKOUT_CODES: ReadonlySet<CheckoutErrorCode> = new Set([
  'plan_not_found',
  'workspace_not_found',
  'plan_not_billable',
  'no_billing_contact',
  'invalid_body',
]);

function toCheckoutCode(raw: unknown): CheckoutErrorCode {
  return typeof raw === 'string' && CHECKOUT_CODES.has(raw as CheckoutErrorCode)
    ? (raw as CheckoutErrorCode)
    : 'unknown';
}

/** Gera o link de cobrança real para o tenant (F41-S07). */
export function useGenerateCheckout(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation<CheckoutResult, CheckoutError, CheckoutInput>({
    mutationFn: async (input) => {
      const res = await fetch(`/api/platform/tenants/${workspaceId}/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        let code: CheckoutErrorCode = 'unknown';
        try {
          const body = (await res.json()) as { error?: unknown };
          code = toCheckoutCode(body.error);
        } catch {
          // resposta sem corpo JSON
        }
        throw new CheckoutError(res.status, code);
      }
      return (await res.json()) as CheckoutResult;
    },
    // A geração grava o intent na subscription; revalida o 360 (auditoria recente).
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'tenant', workspaceId] }),
  });
}
