import { describe, it, expect } from 'vitest';
import { AbacatePayProvider } from './provider';
import { AbacatePayClient } from './client';
import { PaymentProviderError } from '../errors';
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

/** Monta um `fetch` falso que devolve um envelope JSON com o status dado. */
function fakeFetch(status: number, body: unknown): typeof fetch {
  const impl = async (): Promise<Response> =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  return impl as unknown as typeof fetch;
}

function makeProvider(fetchImpl: typeof fetch): AbacatePayProvider {
  return new AbacatePayProvider(
    new AbacatePayClient({ apiKey: 'test_key', fetchImpl, maxAttempts: 1 }),
  );
}

describe('AbacatePayProvider', () => {
  it('id é "abacatepay"', () => {
    expect(makeProvider(fakeFetch(200, { data: {}, success: true })).id).toBe('abacatepay');
  });

  it('exige API key', () => {
    expect(() => new AbacatePayClient({ apiKey: '' })).toThrow(PaymentProviderError);
  });

  it('ensureProduct parseia data do envelope', async () => {
    const p = makeProvider(fakeFetch(200, { data: { id: 'prod_1', externalId: 'plan_pro' }, success: true }));
    const r = await p.ensureProduct(plan);
    expect(r).toEqual({ externalProductId: 'prod_1', planId: 'plan_pro' });
  });

  it('ensureProduct usa externalProductId sem chamar a rede', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const p = makeProvider(spy);
    const r = await p.ensureProduct({ ...plan, externalProductId: 'prod_existing' });
    expect(r.externalProductId).toBe('prod_existing');
    expect(called).toBe(false);
  });

  it('createHostedCheckout devolve redirectUrl', async () => {
    // ensureProduct, ensureCustomer e checkout: três respostas sequenciais.
    const responses = [
      { data: { id: 'prod_1' }, success: true },
      { data: { id: 'cust_1' }, success: true },
      { data: { id: 'chk_1', url: 'https://pay.abacate/checkout/chk_1' }, success: true },
    ];
    let i = 0;
    const seqFetch = (async () => {
      const body = responses[i++];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const p = makeProvider(seqFetch);
    const r = await p.createHostedCheckout({
      plan,
      workspace,
      cycle: 'monthly',
      methods: ['card', 'pix'],
      returnUrl: 'https://app.test/return',
      completionUrl: 'https://app.test/done',
    });
    expect(r.externalId).toBe('chk_1');
    expect(r.redirectUrl).toBe('https://pay.abacate/checkout/chk_1');
  });

  it('normaliza erro HTTP 401 como kind auth', async () => {
    const p = makeProvider(fakeFetch(401, { error: 'invalid api key' }));
    await expect(p.ensureProduct(plan)).rejects.toMatchObject({
      name: 'PaymentProviderError',
      httpStatus: 401,
      kind: 'auth',
    });
  });

  it('trata success:false em 200 como erro de negócio', async () => {
    const p = makeProvider(fakeFetch(200, { data: null, success: false, error: 'plano inexistente' }));
    await expect(p.ensureProduct(plan)).rejects.toMatchObject({
      name: 'PaymentProviderError',
      kind: 'provider',
    });
  });

  it('rejeita resposta com shape inválido (invalid_response)', async () => {
    const p = makeProvider(fakeFetch(200, { data: { id: 123 }, success: true }));
    await expect(p.ensureProduct(plan)).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('5xx é retryable', async () => {
    const p = makeProvider(fakeFetch(503, { error: 'unavailable' }));
    await expect(p.ensureProduct(plan)).rejects.toMatchObject({ retryable: true, kind: 'server' });
  });
});
