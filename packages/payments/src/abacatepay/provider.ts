/**
 * `AbacatePayProvider` — adapter real do `IPaymentProvider` contra a API v2.
 *
 * Traduz o domínio Leadium (centavos/BRL, ciclos, métodos) para os requests da
 * AbacatePay e normaliza as respostas de volta. Idempotência por `externalId`
 * (`plan.id` no product, `workspace.id` no customer).
 *
 * TODO(confirmar contra doc/sandbox, §10): os PATHS dos endpoints e o
 * vocabulário (`frequency`/`methods`/`status`). Centralizados em constantes
 * abaixo para troca trivial quando confirmados.
 */

import type {
  IPaymentProvider,
  PaymentPlanInput,
  PaymentWorkspaceInput,
  ProviderProduct,
  ProviderCustomer,
  CreateHostedCheckoutInput,
  HostedCheckoutResult,
  CreateSubscriptionInput,
  SubscriptionResult,
  CreatePixChargeInput,
  PixChargeResult,
  SubscriptionSnapshot,
  BillingCycle,
  PaymentMethod,
  ProviderSubscriptionStatus,
} from '../types';
import { PaymentProviderError } from '../errors';
import { AbacatePayClient, type AbacatePayClientOptions } from './client';
import {
  ProductDataSchema,
  CustomerDataSchema,
  CheckoutDataSchema,
  SubscriptionDataSchema,
  PixChargeDataSchema,
  CreateProductRequestSchema,
  CreateCustomerRequestSchema,
  CreateCheckoutRequestSchema,
  CreateSubscriptionRequestSchema,
  CreatePixChargeRequestSchema,
} from './schemas';

/**
 * Paths dos endpoints v2. TODO(confirmar): nomes exatos contra a doc.
 * Mantidos aqui para troca trivial.
 */
const ENDPOINTS = {
  products: '/products',
  customers: '/customers',
  checkouts: '/billing',
  subscriptions: '/subscriptions',
  pixCharges: '/pixQrCode/create',
} as const;

/** Mapeia o ciclo de domínio → `frequency` do gateway. TODO(confirmar). */
function toFrequency(cycle: BillingCycle): string {
  return cycle === 'yearly' ? 'YEARLY' : 'MONTHLY';
}

/** Mapeia o método de domínio → enum de método do gateway. TODO(confirmar). */
function toMethod(method: PaymentMethod): string {
  return method === 'pix' ? 'PIX' : 'CARD';
}

/** Mapeia o status do gateway → status normalizado. TODO(confirmar vocabulário). */
function toProviderStatus(status: string | undefined): ProviderSubscriptionStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'ACTIVE':
    case 'PAID':
    case 'COMPLETED':
      return 'active';
    case 'PENDING':
    case 'WAITING':
      return 'pending';
    case 'PAST_DUE':
    case 'OVERDUE':
      return 'past_due';
    case 'CANCELLED':
    case 'CANCELED':
      return 'canceled';
    case 'EXPIRED':
      return 'expired';
    default:
      return 'unknown';
  }
}

/** Mapeia o método do gateway → método de domínio. */
function toDomainMethod(method: string | undefined): PaymentMethod | undefined {
  if (method === undefined) return undefined;
  return method.toUpperCase() === 'PIX' ? 'pix' : 'card';
}

/** Preço do plano para o ciclo escolhido (centavos). */
function priceForCycle(plan: PaymentPlanInput, cycle: BillingCycle): number {
  if (cycle === 'yearly') {
    if (plan.priceYearlyCents === undefined) {
      throw new PaymentProviderError(`Plano ${plan.id} não tem preço anual`, {
        httpStatus: 0,
        kind: 'provider',
      });
    }
    return plan.priceYearlyCents;
  }
  return plan.priceMonthlyCents;
}

export class AbacatePayProvider implements IPaymentProvider {
  readonly id = 'abacatepay' as const;
  private readonly client: AbacatePayClient;

  constructor(opts: AbacatePayClientOptions | AbacatePayClient) {
    this.client = opts instanceof AbacatePayClient ? opts : new AbacatePayClient(opts);
  }

  async ensureProduct(plan: PaymentPlanInput): Promise<ProviderProduct> {
    if (plan.externalProductId) {
      return { externalProductId: plan.externalProductId, planId: plan.id };
    }
    const body = CreateProductRequestSchema.parse({
      name: plan.name,
      description: plan.description,
      price: plan.priceMonthlyCents,
      externalId: plan.id,
    });
    const data = await this.client.post(ENDPOINTS.products, body, ProductDataSchema);
    return { externalProductId: data.id, planId: plan.id };
  }

  async ensureCustomer(workspace: PaymentWorkspaceInput): Promise<ProviderCustomer> {
    if (workspace.externalCustomerId) {
      return { externalCustomerId: workspace.externalCustomerId, workspaceId: workspace.id };
    }
    const body = CreateCustomerRequestSchema.parse({
      name: workspace.name,
      email: workspace.billingEmail,
      cellphone: workspace.billingPhone,
      taxId: workspace.taxId,
      externalId: workspace.id,
    });
    const data = await this.client.post(ENDPOINTS.customers, body, CustomerDataSchema);
    return { externalCustomerId: data.id, workspaceId: workspace.id };
  }

  async createHostedCheckout(input: CreateHostedCheckoutInput): Promise<HostedCheckoutResult> {
    const product = await this.ensureProduct(input.plan);
    const customer = await this.ensureCustomer(input.workspace);
    const price = priceForCycle(input.plan, input.cycle);

    const body = CreateCheckoutRequestSchema.parse({
      frequency: toFrequency(input.cycle),
      methods: input.methods.map(toMethod),
      products: [{ externalId: product.externalProductId, quantity: 1, price }],
      returnUrl: input.returnUrl,
      completionUrl: input.completionUrl,
      customerId: customer.externalCustomerId,
      metadata: {
        workspaceId: input.workspace.id,
        planId: input.plan.id,
        cycle: input.cycle,
      },
    });
    const data = await this.client.post(ENDPOINTS.checkouts, body, CheckoutDataSchema);
    const redirectUrl = data.redirectUrl ?? data.url;
    if (!redirectUrl) {
      throw new PaymentProviderError('Checkout sem URL de redirecionamento', {
        httpStatus: 200,
        kind: 'invalid_response',
      });
    }
    return { externalId: data.id, redirectUrl };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionResult> {
    const body = CreateSubscriptionRequestSchema.parse({
      productExternalId: input.product.externalProductId,
      customerId: input.customer.externalCustomerId,
      frequency: toFrequency(input.cycle),
      returnUrl: input.returnUrl,
      completionUrl: input.completionUrl,
      metadata: {
        workspaceId: input.workspace.id,
        planId: input.plan.id,
        cycle: input.cycle,
      },
    });
    const data = await this.client.post(ENDPOINTS.subscriptions, body, SubscriptionDataSchema);
    return {
      externalSubscriptionId: data.id,
      status: toProviderStatus(data.status),
      redirectUrl: data.redirectUrl ?? data.url,
      currentPeriodEnd: data.currentPeriodEnd ?? data.nextBilling,
    };
  }

  async createPixCharge(input: CreatePixChargeInput): Promise<PixChargeResult> {
    const body = CreatePixChargeRequestSchema.parse({
      amount: input.amountCents,
      expiresIn: input.expiresInSeconds,
      description: `${input.plan.name} (${input.cycle})`,
      customerId: input.customer.externalCustomerId,
      metadata: input.metadata ?? {
        workspaceId: input.workspace.id,
        planId: input.plan.id,
        cycle: input.cycle,
      },
    });
    const data = await this.client.post(ENDPOINTS.pixCharges, body, PixChargeDataSchema);
    return {
      externalId: data.id,
      status: toProviderStatus(data.status),
      amountCents: data.amount ?? input.amountCents,
      brCodeBase64: data.brCodeBase64,
      brCode: data.brCode,
      expiresAt: data.expiresAt,
    };
  }

  async cancelSubscription(externalSubscriptionId: string): Promise<void> {
    // TODO(confirmar): a AbacatePay usa DELETE no recurso ou POST /cancel?
    await this.client.delete(`${ENDPOINTS.subscriptions}/${encodeURIComponent(externalSubscriptionId)}`);
  }

  async getSubscription(externalSubscriptionId: string): Promise<SubscriptionSnapshot> {
    const data = await this.client.get(
      `${ENDPOINTS.subscriptions}/${encodeURIComponent(externalSubscriptionId)}`,
      SubscriptionDataSchema,
    );
    return {
      externalSubscriptionId: data.id,
      status: toProviderStatus(data.status),
      method: toDomainMethod(data.method),
      currentPeriodStart: data.currentPeriodStart,
      currentPeriodEnd: data.currentPeriodEnd ?? data.nextBilling,
      cancelAtPeriodEnd: data.cancelAtPeriodEnd,
      amountCents: data.amount,
    };
  }
}
