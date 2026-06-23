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

interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
}

/** Monta um `fetch` falso que devolve um envelope JSON com o status dado. */
function fakeFetch(status: number, body: unknown): typeof fetch {
  const impl = async (): Promise<Response> =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  return impl as unknown as typeof fetch;
}

/**
 * `fetch` falso que devolve respostas em sequência e captura cada request
 * (url/method/body parseado) para asserts de contrato.
 */
function seqFetchCapturing(
  responses: unknown[],
  captured: CapturedRequest[],
): typeof fetch {
  let i = 0;
  const impl = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    captured.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: rawBody ? JSON.parse(rawBody) : undefined,
    });
    const body = responses[i++];
    return new Response(JSON.stringify(body), { status: 200 });
  };
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

  it('ensureProduct manda /products/create com currency BRL e sem cycle (avulso)', async () => {
    const captured: CapturedRequest[] = [];
    const p = makeProvider(seqFetchCapturing([{ data: { id: 'prod_1' }, success: true }], captured));
    await p.ensureProduct(plan);
    const req = captured[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toContain('/products/create');
    expect(req.body).toMatchObject({
      externalId: 'plan_pro',
      name: 'Pro',
      price: 9900,
      currency: 'BRL',
    });
    expect((req.body as Record<string, unknown>)['cycle']).toBeUndefined();
  });

  it('ensureProduct com cycle manda cycle mapeado e externalId por ciclo', async () => {
    const captured: CapturedRequest[] = [];
    const p = makeProvider(seqFetchCapturing([{ data: { id: 'prod_y' }, success: true }], captured));
    await p.ensureProduct({ ...plan, cycle: 'yearly' });
    expect(captured[0]!.body).toMatchObject({
      externalId: 'plan_pro__ANNUALLY',
      price: 99000,
      currency: 'BRL',
      cycle: 'ANNUALLY',
    });
  });

  it('createHostedCheckout devolve data.url e manda items:[{id,quantity}] sem price', async () => {
    const captured: CapturedRequest[] = [];
    // ensureProduct, ensureCustomer e checkout: três respostas sequenciais.
    const responses = [
      { data: { id: 'prod_1' }, success: true },
      { data: { id: 'cust_1' }, success: true },
      { data: { id: 'bill_1', url: 'https://pay.abacate/checkout/bill_1', amount: 9900 }, success: true },
    ];
    const p = makeProvider(seqFetchCapturing(responses, captured));
    const r = await p.createHostedCheckout({
      plan,
      workspace,
      cycle: 'monthly',
      methods: ['card', 'pix'],
      returnUrl: 'https://app.test/return',
      completionUrl: 'https://app.test/done',
    });
    expect(r.externalId).toBe('bill_1');
    expect(r.redirectUrl).toBe('https://pay.abacate/checkout/bill_1');

    const checkoutReq = captured[2]!;
    expect(checkoutReq.url).toContain('/checkouts/create');
    const cbody = checkoutReq.body as Record<string, unknown>;
    expect(cbody['items']).toEqual([{ id: 'prod_1', quantity: 1 }]);
    expect(cbody['methods']).toEqual(['CARD', 'PIX']);
    expect(cbody['customerId']).toBe('cust_1');
    // items NÃO carrega price (o preço vem do product).
    const items = cbody['items'] as Array<Record<string, unknown>>;
    expect(items[0]!['price']).toBeUndefined();
  });

  it('createSubscription ensura product COM cycle e manda items length 1 + methods CARD', async () => {
    const captured: CapturedRequest[] = [];
    // ensureProduct(cycle) + subscriptions/create.
    const responses = [
      { data: { id: 'prod_year' }, success: true },
      { data: { id: 'bill_sub_1', url: 'https://pay.abacate/subscribe/bill_sub_1', status: 'PENDING' }, success: true },
    ];
    const p = makeProvider(seqFetchCapturing(responses, captured));
    const r = await p.createSubscription({
      plan,
      workspace,
      cycle: 'yearly',
      customer: { externalCustomerId: 'cust_1', workspaceId: workspace.id },
      product: { externalProductId: 'prod_avulso', planId: plan.id },
      returnUrl: 'https://app.test/return',
      completionUrl: 'https://app.test/done',
    });
    expect(r.externalSubscriptionId).toBe('bill_sub_1');
    expect(r.status).toBe('pending');
    expect(r.redirectUrl).toBe('https://pay.abacate/subscribe/bill_sub_1');

    // O product da assinatura é ensurado com cycle (não reusa o avulso).
    expect(captured[0]!.url).toContain('/products/create');
    expect(captured[0]!.body).toMatchObject({ cycle: 'ANNUALLY' });

    const subReq = captured[1]!;
    expect(subReq.url).toContain('/subscriptions/create');
    const sbody = subReq.body as Record<string, unknown>;
    expect(sbody['items']).toEqual([{ id: 'prod_year', quantity: 1 }]);
    expect(sbody['methods']).toEqual(['CARD']);
  });

  it('cancelSubscription faz POST /subscriptions/cancel com body {id}', async () => {
    const captured: CapturedRequest[] = [];
    const p = makeProvider(
      seqFetchCapturing([{ data: { id: 'subs_1', status: 'CANCELLED' }, success: true }], captured),
    );
    await p.cancelSubscription('subs_1');
    const req = captured[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toContain('/subscriptions/cancel');
    expect(req.body).toEqual({ id: 'subs_1' });
  });

  it('createPixCharge gera checkout só-PIX (product no valor do ciclo) e devolve payUrl', async () => {
    const captured: CapturedRequest[] = [];
    // ensureProduct (valor do ciclo) + checkout só-PIX: duas respostas sequenciais.
    const p = makeProvider(
      seqFetchCapturing(
        [
          { data: { id: 'prod_pix' }, success: true },
          {
            data: {
              id: 'bill_pix',
              url: 'https://app.abacatepay.com/pay/bill_pix',
              amount: 9900,
              status: 'PENDING',
            },
            success: true,
          },
        ],
        captured,
      ),
    );
    const r = await p.createPixCharge({
      plan,
      workspace,
      cycle: 'monthly',
      customer: { externalCustomerId: 'cust_1', workspaceId: workspace.id },
      amountCents: 9900,
      expiresInSeconds: 3600,
    });
    expect(r.externalId).toBe('bill_pix');
    expect(r.status).toBe('pending');
    expect(r.payUrl).toBe('https://app.abacatepay.com/pay/bill_pix');
    expect(r.amountCents).toBe(9900);

    // 1º: product avulso no valor do ciclo; 2º: checkout só-PIX referenciando-o.
    expect(captured[0]!.url).toContain('/products/create');
    const co = captured[1]!;
    expect(co.url).toContain('/checkouts/create');
    const body = co.body as Record<string, unknown>;
    expect(body['methods']).toEqual(['PIX']);
    expect(body['items']).toEqual([{ id: 'prod_pix', quantity: 1 }]);
    expect(body['customerId']).toBe('cust_1');
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
