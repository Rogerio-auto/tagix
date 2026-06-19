/**
 * `MockPaymentProvider` — implementação determinística, sem rede.
 *
 * Para dev (sem key) e testes. Ids derivados deterministicamente das entradas,
 * estado em memória, nenhuma chamada externa. Não simula falhas — é o caminho
 * feliz; testes de erro do adapter real usam um `fetch` injetado.
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
} from '../types';

export interface MockPaymentProviderOptions {
  /** Base usada para montar URLs determinísticas. Default: https://mock.pay.local. */
  readonly baseUrl?: string;
}

export class MockPaymentProvider implements IPaymentProvider {
  readonly id = 'mock' as const;
  private readonly baseUrl: string;
  private readonly subscriptions = new Map<string, SubscriptionSnapshot>();

  constructor(opts: MockPaymentProviderOptions = {}) {
    this.baseUrl = opts.baseUrl ?? 'https://mock.pay.local';
  }

  ensureProduct(plan: PaymentPlanInput): Promise<ProviderProduct> {
    return Promise.resolve({
      externalProductId: plan.externalProductId ?? `prod_mock_${plan.id}`,
      planId: plan.id,
    });
  }

  ensureCustomer(workspace: PaymentWorkspaceInput): Promise<ProviderCustomer> {
    return Promise.resolve({
      externalCustomerId: workspace.externalCustomerId ?? `cust_mock_${workspace.id}`,
      workspaceId: workspace.id,
    });
  }

  createHostedCheckout(input: CreateHostedCheckoutInput): Promise<HostedCheckoutResult> {
    const externalId = `chk_mock_${input.workspace.id}_${input.plan.id}_${input.cycle}`;
    return Promise.resolve({
      externalId,
      redirectUrl: `${this.baseUrl}/checkout/${externalId}`,
    });
  }

  createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionResult> {
    const externalSubscriptionId = `sub_mock_${input.workspace.id}_${input.plan.id}_${input.cycle}`;
    const currentPeriodEnd = this.periodEnd(input.cycle);
    this.subscriptions.set(externalSubscriptionId, {
      externalSubscriptionId,
      status: 'active',
      method: 'card',
      currentPeriodStart: new Date(0).toISOString(),
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      amountCents: this.priceForCycle(input.plan, input.cycle),
    });
    return Promise.resolve({
      externalSubscriptionId,
      status: 'active',
      redirectUrl: `${this.baseUrl}/subscribe/${externalSubscriptionId}`,
      currentPeriodEnd,
    });
  }

  createPixCharge(input: CreatePixChargeInput): Promise<PixChargeResult> {
    const externalId = `pix_mock_${input.workspace.id}_${input.plan.id}_${input.cycle}`;
    return Promise.resolve({
      externalId,
      status: 'pending',
      amountCents: input.amountCents,
      brCode: `00020126_MOCK_${externalId}`,
      brCodeBase64: Buffer.from(`mock-qr:${externalId}`).toString('base64'),
      expiresAt: this.expiresAt(input.expiresInSeconds ?? 3600),
    });
  }

  cancelSubscription(externalSubscriptionId: string): Promise<void> {
    const existing = this.subscriptions.get(externalSubscriptionId);
    if (existing) {
      this.subscriptions.set(externalSubscriptionId, { ...existing, status: 'canceled' });
    }
    return Promise.resolve();
  }

  getSubscription(externalSubscriptionId: string): Promise<SubscriptionSnapshot> {
    const existing = this.subscriptions.get(externalSubscriptionId);
    return Promise.resolve(
      existing ?? {
        externalSubscriptionId,
        status: 'unknown',
      },
    );
  }

  private priceForCycle(plan: PaymentPlanInput, cycle: 'monthly' | 'yearly'): number {
    return cycle === 'yearly' ? (plan.priceYearlyCents ?? plan.priceMonthlyCents * 12) : plan.priceMonthlyCents;
  }

  /** Vencimento determinístico relativo à época (estável para snapshots de teste). */
  private periodEnd(cycle: 'monthly' | 'yearly'): string {
    const days = cycle === 'yearly' ? 365 : 30;
    return new Date(days * 24 * 60 * 60 * 1000).toISOString();
  }

  private expiresAt(seconds: number): string {
    return new Date(seconds * 1000).toISOString();
  }
}
