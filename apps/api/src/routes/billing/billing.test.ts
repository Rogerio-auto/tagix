/**
 * Testes do billing self-serve (F41-S04, PAYMENTS_ABACATEPAY.md §5/§9).
 *
 * Determinísticos e sem rede: o `MockPaymentProvider` é forçado (sem
 * `ABACATEPAY_API_KEY`), os middlewares de auth são mockados e o `@hm/db` é
 * substituído por um stub em memória. Cobrimos:
 *  - checkout cria sessão hospedada (redirectUrl) e usa o preço do CATÁLOGO;
 *  - cancelamento (cartão chama o provider; PIX só agenda corte);
 *  - isolamento por workspace (cada request enxerga só a própria subscription);
 *  - authz: sem sessão → 401.
 */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const WS_A = '00000000-0000-0000-0000-00000000000a';
const WS_B = '00000000-0000-0000-0000-00000000000b';
const PLAN_ID = '00000000-0000-0000-0000-0000000000f0';

// ── Fixtures de domínio em memória ──────────────────────────────────────────
const planCatalog = {
  id: PLAN_ID,
  key: 'pro',
  name: 'Pro',
  description: 'Plano Pro',
  priceMonthlyCents: 9900,
  priceYearlyCents: 99000,
  paymentProviderProductId: null as string | null,
  isActive: true,
};

interface SubRow {
  workspaceId: string;
  planId: string;
  status: string;
  billingCycle: string;
  paymentProvider: string | null;
  externalCustomerId: string | null;
  externalSubscriptionId: string | null;
  externalProductId: string | null;
  paymentMethod: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
}

const subsByWorkspace = new Map<string, SubRow>();

// Estado de auth controlado por teste (qual workspace / role faz a request).
let currentAuth: { workspaceId: string; email: string; role: string } | null = null;

// ── Mock dos middlewares de auth ─────────────────────────────────────────────
vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!currentAuth) {
      res.status(401).json({ message: 'Não autenticado.' });
      return;
    }
    req.auth = {
      workspace: { id: currentAuth.workspaceId, name: 'WS' },
      member: { id: 'mem-1', email: currentAuth.email, role: currentAuth.role },
    } as unknown as typeof req.auth;
    next();
  },
  withRLS: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const wsId = currentAuth?.workspaceId ?? '';
    (req as unknown as { scoped: unknown }).scoped = <T>(fn: (tx: unknown) => Promise<T>) =>
      fn(makeScopedTx(wsId));
    next();
  },
  requireRole:
    (_perm: string) =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
      next();
    },
}));

// ── Mock do @hm/db ────────────────────────────────────────────────────────────
// getDb() devolve um cliente que só sabe ler/atualizar o catálogo `plans`.
vi.mock('@hm/db', () => {
  const plansTable = { __t: 'plans' };
  const subsTable = { __t: 'subscriptions' };
  const eventsTable = { __t: 'payment_events' };

  // Builder mínimo de leitura de plano via getDb (owner, não-RLS).
  const getDb = () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([planCatalog]),
        }),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => {
          if (typeof patch['paymentProviderProductId'] === 'string') {
            planCatalog.paymentProviderProductId = patch['paymentProviderProductId'];
          }
          return Promise.resolve();
        },
      }),
    }),
  });

  return {
    getDb,
    schema: { plans: plansTable, subscriptions: subsTable, paymentEvents: eventsTable },
  };
});

// ── Tx escopado (RLS) por workspace, em memória ──────────────────────────────
function makeScopedTx(workspaceId: string) {
  return {
    select: () => ({
      from: (table: { __t: string }) => {
        const resolve = () => {
          if (table.__t === 'subscriptions') {
            const row = subsByWorkspace.get(workspaceId);
            return Promise.resolve(row ? [row] : []);
          }
          if (table.__t === 'plans') return Promise.resolve([planCatalog]);
          return Promise.resolve([]); // payment_events: histórico vazio nos testes
        };
        return {
          where: () => ({
            limit: resolve,
            orderBy: () => ({ limit: resolve }),
          }),
        };
      },
    }),
    insert: () => ({
      values: (v: Partial<SubRow>) => ({
        onConflictDoUpdate: ({ set }: { set: Partial<SubRow> }) => {
          const existing = subsByWorkspace.get(workspaceId);
          subsByWorkspace.set(workspaceId, {
            ...defaultSub(workspaceId),
            ...existing,
            ...v,
            ...set,
          });
          return Promise.resolve();
        },
      }),
    }),
    update: () => ({
      set: (patch: Partial<SubRow>) => ({
        where: () => {
          const existing = subsByWorkspace.get(workspaceId);
          if (existing) subsByWorkspace.set(workspaceId, { ...existing, ...patch });
          return Promise.resolve();
        },
      }),
    }),
  };
}

function defaultSub(workspaceId: string): SubRow {
  return {
    workspaceId,
    planId: PLAN_ID,
    status: 'trial',
    billingCycle: 'monthly',
    paymentProvider: null,
    externalCustomerId: null,
    externalSubscriptionId: null,
    externalProductId: null,
    paymentMethod: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
  };
}

// ── App sob teste ────────────────────────────────────────────────────────────
async function buildApp() {
  const { createBillingRouter } = await import('./index');
  const app = express();
  app.use(express.json());
  app.use(createBillingRouter());
  return app;
}

beforeEach(() => {
  delete process.env['ABACATEPAY_API_KEY']; // força MockPaymentProvider
  subsByWorkspace.clear();
  planCatalog.paymentProviderProductId = null;
  currentAuth = null;
  vi.resetModules();
});

describe('POST /api/billing/checkout', () => {
  it('sem sessão → 401', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/api/billing/checkout')
      .send({ planId: PLAN_ID, cycle: 'monthly', method: 'card' });
    expect(res.status).toBe(401);
  });

  it('body inválido → 400', async () => {
    currentAuth = { workspaceId: WS_A, email: 'owner@a.dev', role: 'OWNER' };
    const app = await buildApp();
    const res = await request(app).post('/api/billing/checkout').send({ cycle: 'monthly' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('cria checkout hospedado e devolve redirectUrl (mock)', async () => {
    currentAuth = { workspaceId: WS_A, email: 'owner@a.dev', role: 'OWNER' };
    const app = await buildApp();
    const res = await request(app)
      .post('/api/billing/checkout')
      .send({ planId: PLAN_ID, cycle: 'monthly', method: 'pix' });
    expect(res.status).toBe(201);
    expect(res.body.redirectUrl).toContain('/checkout/');
    // intent gravado no workspace correto
    const sub = subsByWorkspace.get(WS_A);
    expect(sub?.paymentMethod).toBe('pix');
    expect(sub?.paymentProvider).toBe('abacatepay');
    expect(sub?.externalProductId).toBe(`prod_mock_${PLAN_ID}`);
    expect(planCatalog.paymentProviderProductId).toBe(`prod_mock_${PLAN_ID}`);
  });
});

describe('GET /api/billing/subscription', () => {
  it('devolve estado da própria subscription, isolado por workspace', async () => {
    // Workspace A assina (cartão); workspace B nunca assinou.
    currentAuth = { workspaceId: WS_A, email: 'owner@a.dev', role: 'OWNER' };
    let app = await buildApp();
    await request(app)
      .post('/api/billing/checkout')
      .send({ planId: PLAN_ID, cycle: 'yearly', method: 'card' });

    // A vê a sua assinatura.
    currentAuth = { workspaceId: WS_A, email: 'owner@a.dev', role: 'ADMIN' };
    app = await buildApp();
    const resA = await request(app).get('/api/billing/subscription');
    expect(resA.status).toBe(200);
    expect(resA.body.subscription?.paymentMethod).toBe('card');
    expect(resA.body.subscription?.billingCycle).toBe('yearly');
    expect(resA.body.subscription?.plan?.key).toBe('pro');

    // B não enxerga a de A (isolamento) → subscription null.
    currentAuth = { workspaceId: WS_B, email: 'owner@b.dev', role: 'ADMIN' };
    app = await buildApp();
    const resB = await request(app).get('/api/billing/subscription');
    expect(resB.status).toBe(200);
    expect(resB.body.subscription).toBeNull();
  });
});

describe('POST /api/billing/cancel', () => {
  it('sem subscription → 404', async () => {
    currentAuth = { workspaceId: WS_A, email: 'owner@a.dev', role: 'OWNER' };
    const app = await buildApp();
    const res = await request(app).post('/api/billing/cancel').send({});
    expect(res.status).toBe(404);
  });

  it('PIX → agenda corte no fim do ciclo (cancel_at_period_end)', async () => {
    subsByWorkspace.set(WS_A, {
      ...defaultSub(WS_A),
      paymentMethod: 'pix',
      paymentProvider: 'abacatepay',
      status: 'active',
    });
    currentAuth = { workspaceId: WS_A, email: 'owner@a.dev', role: 'OWNER' };
    const app = await buildApp();
    const res = await request(app).post('/api/billing/cancel').send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ canceled: true, method: 'pix', effective: 'period_end' });
    expect(subsByWorkspace.get(WS_A)?.cancelAtPeriodEnd).toBe(true);
  });

  it('cartão → cancela no provider e agenda corte', async () => {
    subsByWorkspace.set(WS_A, {
      ...defaultSub(WS_A),
      paymentMethod: 'card',
      paymentProvider: 'abacatepay',
      externalSubscriptionId: 'sub_ext_a',
      status: 'active',
    });
    currentAuth = { workspaceId: WS_A, email: 'owner@a.dev', role: 'OWNER' };
    const app = await buildApp();
    const res = await request(app).post('/api/billing/cancel').send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ canceled: true, method: 'card', effective: 'period_end' });
    expect(subsByWorkspace.get(WS_A)?.cancelAtPeriodEnd).toBe(true);
  });
});
