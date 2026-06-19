import { describe, it, expect } from 'vitest';
import { MockPaymentProvider } from './provider';
import type { PaymentPlanInput, PaymentWorkspaceInput } from '../types';

const plan: PaymentPlanInput = {
  id: 'plan_pro',
  name: 'Pro',
  priceMonthlyCents: 9900,
  priceYearlyCents: 99000,
};

const workspace: PaymentWorkspaceInput = {
  id: 'ws_123',
  name: 'Acme Ltda',
  billingEmail: 'billing@acme.com',
};

describe('MockPaymentProvider', () => {
  it('expõe id "mock"', () => {
    expect(new MockPaymentProvider().id).toBe('mock');
  });

  it('ensureProduct é determinístico e idempotente', async () => {
    const p = new MockPaymentProvider();
    const a = await p.ensureProduct(plan);
    const b = await p.ensureProduct(plan);
    expect(a).toEqual({ externalProductId: 'prod_mock_plan_pro', planId: 'plan_pro' });
    expect(a).toEqual(b);
  });

  it('ensureProduct respeita externalProductId pré-existente', async () => {
    const p = new MockPaymentProvider();
    const r = await p.ensureProduct({ ...plan, externalProductId: 'prod_existing' });
    expect(r.externalProductId).toBe('prod_existing');
  });

  it('ensureCustomer é determinístico', async () => {
    const p = new MockPaymentProvider();
    const r = await p.ensureCustomer(workspace);
    expect(r).toEqual({ externalCustomerId: 'cust_mock_ws_123', workspaceId: 'ws_123' });
  });

  it('createHostedCheckout retorna redirectUrl determinística', async () => {
    const p = new MockPaymentProvider({ baseUrl: 'https://pay.test' });
    const r = await p.createHostedCheckout({
      plan,
      workspace,
      cycle: 'monthly',
      methods: ['card', 'pix'],
      returnUrl: 'https://app.test/return',
      completionUrl: 'https://app.test/done',
    });
    expect(r.externalId).toBe('chk_mock_ws_123_plan_pro_monthly');
    expect(r.redirectUrl).toBe('https://pay.test/checkout/chk_mock_ws_123_plan_pro_monthly');
  });

  it('createSubscription registra estado e getSubscription o devolve', async () => {
    const p = new MockPaymentProvider();
    const product = await p.ensureProduct(plan);
    const customer = await p.ensureCustomer(workspace);
    const sub = await p.createSubscription({
      plan,
      workspace,
      cycle: 'yearly',
      product,
      customer,
      returnUrl: 'https://app.test/return',
      completionUrl: 'https://app.test/done',
    });
    expect(sub.status).toBe('active');
    expect(sub.externalSubscriptionId).toBe('sub_mock_ws_123_plan_pro_yearly');

    const snap = await p.getSubscription(sub.externalSubscriptionId);
    expect(snap.status).toBe('active');
    expect(snap.method).toBe('card');
    expect(snap.amountCents).toBe(99000);
  });

  it('cancelSubscription muda o status para canceled', async () => {
    const p = new MockPaymentProvider();
    const product = await p.ensureProduct(plan);
    const customer = await p.ensureCustomer(workspace);
    const sub = await p.createSubscription({
      plan,
      workspace,
      cycle: 'monthly',
      product,
      customer,
      returnUrl: 'https://app.test/return',
      completionUrl: 'https://app.test/done',
    });
    await p.cancelSubscription(sub.externalSubscriptionId);
    const snap = await p.getSubscription(sub.externalSubscriptionId);
    expect(snap.status).toBe('canceled');
  });

  it('getSubscription de id desconhecido retorna unknown', async () => {
    const snap = await new MockPaymentProvider().getSubscription('sub_nope');
    expect(snap.status).toBe('unknown');
  });

  it('createPixCharge retorna brCode + amount pedidos', async () => {
    const p = new MockPaymentProvider();
    const customer = await p.ensureCustomer(workspace);
    const charge = await p.createPixCharge({
      plan,
      workspace,
      cycle: 'monthly',
      customer,
      amountCents: 9900,
    });
    expect(charge.status).toBe('pending');
    expect(charge.amountCents).toBe(9900);
    expect(charge.brCode).toContain('pix_mock_ws_123_plan_pro_monthly');
    expect(charge.brCodeBase64).toBeDefined();
    expect(charge.expiresAt).toBeDefined();
  });
});
