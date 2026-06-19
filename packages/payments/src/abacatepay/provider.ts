/**
 * `AbacatePayProvider` — adapter real do `IPaymentProvider` contra a API v2.
 *
 * Traduz o domínio Leadium (centavos/BRL, ciclos, métodos) para os requests da
 * AbacatePay e normaliza as respostas de volta. Endpoints e shapes confirmados
 * contra a doc oficial (docs.abacatepay.com).
 *
 * Idempotência por `externalId`: `plan.id` no product avulso, `plan.id__CYCLE`
 * no product de assinatura (precisa carregar `cycle`), `workspace.id` no customer
 * (via metadata). O `customers/create` não expõe `externalId` próprio na v2 →
 * gravamos a correlação em `metadata`.
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
  CancelSubscriptionDataSchema,
  PixChargeDataSchema,
  CreateProductRequestSchema,
  CreateCustomerRequestSchema,
  CreateCheckoutRequestSchema,
  CreateSubscriptionRequestSchema,
  CancelSubscriptionRequestSchema,
  CreatePixChargeRequestSchema,
} from './schemas';

/** Paths dos endpoints v2 (confirmados). Todos POST salvo `get`/`check` (GET). */
const ENDPOINTS = {
  productsCreate: '/products/create',
  customersCreate: '/customers/create',
  checkoutsCreate: '/checkouts/create',
  subscriptionsCreate: '/subscriptions/create',
  subscriptionsCancel: '/subscriptions/cancel',
  subscriptionsList: '/subscriptions/list',
  pixCreate: '/transparents/create',
  pixCheck: '/transparents/check',
} as const;

/** Mapeia o ciclo de domínio → `cycle` do gateway (monthly→MONTHLY, yearly→ANNUALLY). */
function toCycle(cycle: BillingCycle): 'MONTHLY' | 'ANNUALLY' {
  return cycle === 'yearly' ? 'ANNUALLY' : 'MONTHLY';
}

/** Mapeia o método de domínio → enum de método do gateway. */
function toMethod(method: PaymentMethod): 'PIX' | 'CARD' {
  return method === 'pix' ? 'PIX' : 'CARD';
}

/**
 * Mapeia o status do gateway → status normalizado.
 * Status de assinatura/cobrança: PENDING, EXPIRED, CANCELLED, PAID, REFUNDED.
 */
function toProviderStatus(status: string | undefined): ProviderSubscriptionStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'PAID':
    case 'ACTIVE':
      return 'active';
    case 'PENDING':
      return 'pending';
    case 'REFUNDED':
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

/**
 * `externalId` do product no gateway. Um product de assinatura (com `cycle`) é
 * distinto do avulso, e cada ciclo tem o seu — `cycle` faz parte da identidade
 * para não colidir um product avulso (sem ciclo) com o de assinatura.
 */
function productExternalId(plan: PaymentPlanInput): string {
  return plan.cycle ? `${plan.id}__${toCycle(plan.cycle)}` : plan.id;
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
    // Preço para o ciclo do product (assinatura) ou mensal (avulso).
    const price = plan.cycle ? priceForCycle(plan, plan.cycle) : plan.priceMonthlyCents;
    const body = CreateProductRequestSchema.parse({
      externalId: productExternalId(plan),
      name: plan.name,
      price,
      currency: 'BRL',
      description: plan.description,
      cycle: plan.cycle ? toCycle(plan.cycle) : undefined,
    });
    const data = await this.client.post(ENDPOINTS.productsCreate, body, ProductDataSchema);
    return { externalProductId: data.id, planId: plan.id };
  }

  async ensureCustomer(workspace: PaymentWorkspaceInput): Promise<ProviderCustomer> {
    if (workspace.externalCustomerId) {
      return { externalCustomerId: workspace.externalCustomerId, workspaceId: workspace.id };
    }
    const body = CreateCustomerRequestSchema.parse({
      email: workspace.billingEmail,
      name: workspace.name,
      cellphone: workspace.billingPhone,
      taxId: workspace.taxId,
      // `externalId` não é campo de customer na v2 → correlação por metadata.
      metadata: { workspaceId: workspace.id },
    });
    const data = await this.client.post(ENDPOINTS.customersCreate, body, CustomerDataSchema);
    return { externalCustomerId: data.id, workspaceId: workspace.id };
  }

  async createHostedCheckout(input: CreateHostedCheckoutInput): Promise<HostedCheckoutResult> {
    // Product avulso (sem cycle): preço único, `items[].id` = id do product.
    const product = await this.ensureProduct(input.plan);
    const customer = await this.ensureCustomer(input.workspace);

    const body = CreateCheckoutRequestSchema.parse({
      items: [{ id: product.externalProductId, quantity: 1 }],
      methods: input.methods.map(toMethod),
      customerId: customer.externalCustomerId,
      returnUrl: input.returnUrl,
      completionUrl: input.completionUrl,
      metadata: {
        workspaceId: input.workspace.id,
        planId: input.plan.id,
        cycle: input.cycle,
      },
    });
    const data = await this.client.post(ENDPOINTS.checkoutsCreate, body, CheckoutDataSchema);
    return { externalId: data.id, redirectUrl: data.url };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionResult> {
    // A assinatura exige um product COM cycle. O product avulso (ensurePlanProduct)
    // não tem ciclo → garantimos um product específico do ciclo aqui (idempotente
    // por `plan.id__CYCLE`).
    const subscriptionProduct = await this.ensureProduct({
      id: input.plan.id,
      name: input.plan.name,
      priceMonthlyCents: input.plan.priceMonthlyCents,
      priceYearlyCents: input.plan.priceYearlyCents,
      description: input.plan.description,
      cycle: input.cycle,
    });

    const body = CreateSubscriptionRequestSchema.parse({
      items: [{ id: subscriptionProduct.externalProductId, quantity: 1 }],
      methods: ['CARD'],
      customerId: input.customer.externalCustomerId,
      returnUrl: input.returnUrl,
      completionUrl: input.completionUrl,
      metadata: {
        workspaceId: input.workspace.id,
        planId: input.plan.id,
        cycle: input.cycle,
      },
    });
    const data = await this.client.post(ENDPOINTS.subscriptionsCreate, body, SubscriptionDataSchema);
    return {
      externalSubscriptionId: data.id,
      status: toProviderStatus(data.status),
      redirectUrl: data.url,
    };
  }

  async createPixCharge(input: CreatePixChargeInput): Promise<PixChargeResult> {
    // `/transparents/create` aninha tudo sob `{ data: {...} }`.
    const body = CreatePixChargeRequestSchema.parse({
      data: {
        amount: input.amountCents,
        expiresIn: input.expiresInSeconds,
        description: `${input.plan.name} (${input.cycle})`,
        customer: {
          name: input.workspace.name,
          email: input.workspace.billingEmail,
          taxId: input.workspace.taxId,
          cellphone: input.workspace.billingPhone,
        },
        metadata: input.metadata ?? {
          workspaceId: input.workspace.id,
          planId: input.plan.id,
          cycle: input.cycle,
        },
      },
    });
    const data = await this.client.post(ENDPOINTS.pixCreate, body, PixChargeDataSchema);
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
    // POST /subscriptions/cancel com body { id: 'subs_…' } (não DELETE no path).
    const body = CancelSubscriptionRequestSchema.parse({ id: externalSubscriptionId });
    await this.client.post(ENDPOINTS.subscriptionsCancel, body, CancelSubscriptionDataSchema);
  }

  async getSubscription(externalSubscriptionId: string): Promise<SubscriptionSnapshot> {
    // A v2 não expõe get-by-id de subscription; só `GET /subscriptions/list`.
    // A fonte da verdade do estado é o webhook + nosso DB; aqui devolvemos o
    // mínimo correlacionável sem custo de uma listagem completa.
    // TODO(sandbox): se `/subscriptions/list` suportar filtro por id (`?id=`),
    //   ler o status real aqui em vez de devolver 'unknown'.
    return {
      externalSubscriptionId,
      status: 'unknown',
    };
  }
}
