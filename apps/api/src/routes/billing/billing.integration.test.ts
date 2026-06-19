/**
 * Teste de integracao ponta-a-ponta do CICLO DE VIDA de billing (F41-S09 capstone).
 *
 * Atravessa o caminho do dinheiro inteiro com o MockPaymentProvider real e o HMAC
 * real do @hm/payments, usando um unico banco em memoria compartilhado pelos DOIS
 * lados: checkout self-serve -> webhook completed -> renewed -> cancelled. Cobre
 * tambem HMAC obrigatorio (401 sem assinatura), idempotencia de replay e a regra
 * dura de plano/preco server-side (payload forjado nao troca o plano cobrado).
 *
 * Sem rede e sem Postgres: MockPaymentProvider forcado (delete da ABACATEPAY_API_KEY
 * + reset do singleton, como em subscriptions.test.ts) e @hm/db e um fake stateful
 * que encena os builders Drizzle de AMBAS as rotas. O HMAC NAO e mockado.
 */
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'integration_webhook_secret';
process.env['ABACATEPAY_WEBHOOK_SECRET'] = SECRET;
delete process.env['ABACATEPAY_PUBLIC_KEY'];

const WEBHOOK_PATH = `/webhooks/abacatepay?webhookSecret=${SECRET}`;

const WS_ID = '00000000-0000-0000-0000-0000000000aa';
const PLAN_ID = '00000000-0000-0000-0000-0000000000f0';
const OTHER_PLAN_ID = '00000000-0000-0000-0000-0000000000f9';
const EXT_SUB = 'chk_mock_' + WS_ID + '_' + PLAN_ID + '_monthly';

interface SubRow {
  workspaceId: string;
  planId: string | null;
  status: string;
  billingCycle: string;
  paymentProvider: string | null;
  externalCustomerId: string | null;
  externalSubscriptionId: string | null;
  externalProductId: string | null;
  paymentMethod: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  trialEndsAt: Date | null;
}

interface WorkspaceRow {
  id: string;
  planId: string | null;
  subscriptionStatus: string;
  trialEndsAt: Date | null;
}

interface PlanRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  paymentProviderProductId: string | null;
  isActive: boolean;
  position: number;
}

interface PaymentEventRow {
  id: string;
  provider: string;
  externalEventId: string;
  eventType: string;
  status: string | null;
  amountCents: number | null;
  workspaceId: string | null;
  processedAt: Date | null;
  receivedAt: Date;
}

interface State {
  workspace: WorkspaceRow;
  subscription: SubRow | null;
  plans: Map<string, PlanRow>;
  webhookEvents: Set<string>;
  paymentEvents: Map<string, PaymentEventRow>;
  audits: { action: string; metadata: Record<string, unknown> }[];
}

let state: State;

function freshState(): State {
  const plans = new Map<string, PlanRow>();
  plans.set(PLAN_ID, {
    id: PLAN_ID,
    key: 'pro',
    name: 'Pro',
    description: 'Plano Pro',
    priceMonthlyCents: 9900,
    priceYearlyCents: 99000,
    paymentProviderProductId: null,
    isActive: true,
    position: 1,
  });
  plans.set(OTHER_PLAN_ID, {
    id: OTHER_PLAN_ID,
    key: 'enterprise',
    name: 'Enterprise',
    description: 'Plano Enterprise',
    priceMonthlyCents: 99900,
    priceYearlyCents: 999000,
    paymentProviderProductId: null,
    isActive: true,
    position: 2,
  });
  return {
    workspace: {
      id: WS_ID,
      planId: PLAN_ID,
      subscriptionStatus: 'trial',
      trialEndsAt: new Date('2026-07-01T00:00:00Z'),
    },
    subscription: null,
    plans,
    webhookEvents: new Set(),
    paymentEvents: new Map(),
    audits: [],
  };
}

type TableName =
  | 'webhook_events'
  | 'payment_events'
  | 'subscriptions'
  | 'workspaces'
  | 'plans'
  | 'audit_logs';

interface Col {
  __name: TableName;
  col: string;
}
interface Table {
  __name: TableName;
  [column: string]: Col | TableName;
}

function makeTable(name: TableName, cols: string[]): Table {
  const t: Table = { __name: name };
  for (const c of cols) t[c] = { __name: name, col: c };
  return t;
}

const TBL = {
  webhookEvents: 'webhook_events',
  paymentEvents: 'payment_events',
  subscriptions: 'subscriptions',
  workspaces: 'workspaces',
  plans: 'plans',
  auditLogs: 'audit_logs',
} as const;

interface Predicate {
  col: string;
  val: unknown;
}

function defaultSubFor(): SubRow {
  return {
    workspaceId: WS_ID,
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
    trialEndsAt: null,
  };
}

function makeDb() {
  return {
    insert(tbl: Table) {
      const table = tbl.__name;
      return {
        values(vals: Record<string, unknown>) {
          return {
            onConflictDoNothing() {
              return {
                async returning() {
                  if (table === TBL.webhookEvents) {
                    const key = String(vals['provider']) + '|' + String(vals['externalEventId']);
                    if (state.webhookEvents.has(key)) return [];
                    state.webhookEvents.add(key);
                    return [{ id: 'we_1' }];
                  }
                  if (table === TBL.paymentEvents) {
                    const key = String(vals['provider']) + '|' + String(vals['externalEventId']);
                    if (state.paymentEvents.has(key)) return [];
                    const id = 'pe_' + (state.paymentEvents.size + 1);
                    state.paymentEvents.set(key, {
                      id,
                      provider: String(vals['provider']),
                      externalEventId: String(vals['externalEventId']),
                      eventType: String(vals['eventType'] ?? ''),
                      status: null,
                      amountCents: null,
                      workspaceId: null,
                      processedAt: null,
                      receivedAt: new Date(),
                    });
                    return [{ id }];
                  }
                  return [];
                },
              };
            },
            onConflictDoUpdate(arg: { set: Record<string, unknown> }) {
              if (table === TBL.subscriptions) {
                const existing = state.subscription;
                state.subscription = {
                  ...defaultSubFor(),
                  ...(existing ?? {}),
                  ...vals,
                  ...arg.set,
                  workspaceId: WS_ID,
                } as SubRow;
              }
              return Promise.resolve();
            },
            async then(resolve: (v: unknown) => void) {
              if (table === TBL.auditLogs) {
                state.audits.push({
                  action: String(vals['action']),
                  metadata: (vals['metadata'] as Record<string, unknown>) ?? {},
                });
              }
              if (table === TBL.subscriptions) {
                state.subscription = {
                  ...defaultSubFor(),
                  ...(state.subscription ?? {}),
                  ...vals,
                  workspaceId: WS_ID,
                } as SubRow;
              }
              resolve(undefined);
            },
          };
        },
      };
    },
    select(_cols?: unknown) {
      return {
        from(tbl: Table) {
          const table = tbl.__name;
          const preds: Predicate[] = [];
          const builder = {
            where(pred: Predicate | Predicate[]) {
              if (Array.isArray(pred)) preds.push(...pred);
              else preds.push(pred);
              return builder;
            },
            orderBy() {
              return builder;
            },
            async limit() {
              return runSelect(table, preds);
            },
            async then(resolve: (v: unknown) => void) {
              resolve(runSelect(table, preds));
            },
          };
          return builder;
        },
      };
    },
    update(tbl: Table) {
      const table = tbl.__name;
      return {
        set(vals: Record<string, unknown>) {
          return {
            async where(pred: Predicate) {
              applyUpdate(table, pred, vals);
            },
          };
        },
      };
    },
  };
}

function runSelect(table: TableName, preds: Predicate[]): Record<string, unknown>[] {
  if (table === TBL.subscriptions) {
    if (!state.subscription) return [];
    const byExt = preds.find((p) => p.col === 'externalSubscriptionId');
    const byWs = preds.find((p) => p.col === 'workspaceId');
    if (byExt && state.subscription.externalSubscriptionId !== byExt.val) return [];
    if (byWs && state.subscription.workspaceId !== byWs.val) return [];
    return [{ ...state.subscription }];
  }
  if (table === TBL.workspaces) {
    return [
      {
        id: state.workspace.id,
        planId: state.workspace.planId,
        subscriptionStatus: state.workspace.subscriptionStatus,
        trialEndsAt: state.workspace.trialEndsAt,
      },
    ];
  }
  if (table === TBL.plans) {
    const byId = preds.find((p) => p.col === 'id');
    if (byId) {
      const plan = state.plans.get(String(byId.val));
      return plan ? [{ ...plan }] : [];
    }
    return [...state.plans.values()].filter((p) => p.isActive).map((p) => ({ ...p }));
  }
  if (table === TBL.paymentEvents) {
    const byEvent = preds.find((p) => p.col === 'externalEventId');
    if (byEvent) {
      for (const [key, row] of state.paymentEvents) {
        if (key.endsWith('|' + String(byEvent.val))) {
          return [{ id: row.id, processedAt: row.processedAt }];
        }
      }
      return [];
    }
    const byWs = preds.find((p) => p.col === 'workspaceId');
    return [...state.paymentEvents.values()]
      .filter((r) => (byWs ? r.workspaceId === byWs.val : true))
      .map((r) => ({ ...r }));
  }
  return [];
}

function applyUpdate(table: TableName, pred: Predicate, vals: Record<string, unknown>): void {
  if (table === TBL.workspaces) {
    if ('subscriptionStatus' in vals) state.workspace.subscriptionStatus = String(vals['subscriptionStatus']);
    if ('planId' in vals) state.workspace.planId = (vals['planId'] as string | null) ?? null;
    if ('trialEndsAt' in vals) state.workspace.trialEndsAt = (vals['trialEndsAt'] as Date | null) ?? null;
  } else if (table === TBL.subscriptions) {
    if (!state.subscription) state.subscription = defaultSubFor();
    const s = state.subscription;
    if ('status' in vals) s.status = String(vals['status']);
    if ('planId' in vals) s.planId = (vals['planId'] as string | null) ?? null;
    if ('currentPeriodEnd' in vals) s.currentPeriodEnd = (vals['currentPeriodEnd'] as Date | null) ?? null;
    if ('canceledAt' in vals) s.canceledAt = (vals['canceledAt'] as Date | null) ?? null;
    if ('cancelAtPeriodEnd' in vals) s.cancelAtPeriodEnd = Boolean(vals['cancelAtPeriodEnd']);
    if ('trialEndsAt' in vals) s.trialEndsAt = (vals['trialEndsAt'] as Date | null) ?? null;
  } else if (table === TBL.plans) {
    const byId = pred.col === 'id' ? String(pred.val) : null;
    if (byId && typeof vals['paymentProviderProductId'] === 'string') {
      const plan = state.plans.get(byId);
      if (plan) plan.paymentProviderProductId = String(vals['paymentProviderProductId']);
    }
  } else if (table === TBL.paymentEvents) {
    for (const row of state.paymentEvents.values()) {
      if (row.id === pred.val) {
        if ('processedAt' in vals) row.processedAt = (vals['processedAt'] as Date | null) ?? null;
        if ('status' in vals) row.status = (vals['status'] as string | null) ?? null;
        if ('workspaceId' in vals) row.workspaceId = (vals['workspaceId'] as string | null) ?? null;
      }
    }
  }
}

vi.mock('@hm/db', () => ({
  getDb: () => makeDb(),
  schema: {
    webhookEvents: makeTable('webhook_events', ['provider', 'externalEventId']),
    paymentEvents: makeTable('payment_events', [
      'id',
      'provider',
      'externalEventId',
      'processedAt',
      'workspaceId',
      'receivedAt',
    ]),
    subscriptions: makeTable('subscriptions', ['workspaceId', 'externalSubscriptionId']),
    workspaces: makeTable('workspaces', ['id']),
    plans: makeTable('plans', ['id', 'isActive', 'position']),
    auditLogs: makeTable('audit_logs', []),
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: { col: string }, val: unknown) => ({ col: col.col, val }),
  and: (...preds: unknown[]) => preds,
  asc: (col: { col: string }) => col,
  desc: (col: { col: string }) => col,
}));

vi.mock('@hm/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../middlewares/auth', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.auth = {
      workspace: { id: WS_ID, name: 'WS' },
      member: { id: 'mem-1', email: 'owner@a.dev', role: 'OWNER' },
    } as unknown as typeof req.auth;
    next();
  },
  withRLS: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { scoped: unknown }).scoped = <T>(fn: (tx: unknown) => Promise<T>) =>
      fn(makeDb());
    next();
  },
  requireRole:
    (_perm: string) =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
}));

async function buildApp() {
  const { createAbacatePayWebhookRouter } = await import('../webhooks/abacatepay');
  const { createBillingRouter } = await import('./index');
  const app = express();
  app.use(createAbacatePayWebhookRouter());
  app.use(express.json());
  app.use(createBillingRouter());
  return app;
}

function webhookPayload(eventType: string, data: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'log_' + eventType + '_' + Math.random().toString(36).slice(2),
    event: eventType,
    apiVersion: 'v2',
    devMode: false,
    data: { id: EXT_SUB, metadata: { workspaceId: WS_ID }, ...data },
  });
}

/**
 * Posta o webhook. Por default usa o secret correto na query (auth primária);
 * `withSecret: false` simula a chamada SEM auth (→ 401).
 */
async function postWebhook(
  app: express.Express,
  body: string,
  opts: { withSecret?: boolean } = {},
) {
  const path = opts.withSecret === false ? '/webhooks/abacatepay' : WEBHOOK_PATH;
  return request(app).post(path).set('content-type', 'application/json').send(body);
}

beforeEach(() => {
  delete process.env['ABACATEPAY_API_KEY'];
  state = freshState();
  vi.resetModules();
});

describe('billing ciclo de vida ponta-a-ponta (checkout completed renewed cancelled)', () => {
  it('atravessa o ciclo completo do dinheiro', async () => {
    const app = await buildApp();

    const checkout = await request(app)
      .post('/api/billing/checkout')
      .send({ planId: PLAN_ID, cycle: 'monthly', method: 'card' });
    expect(checkout.status).toBe(201);
    expect(checkout.body.redirectUrl).toContain('/checkout/');
    expect(state.subscription?.paymentProvider).toBe('abacatepay');
    expect(state.subscription?.paymentMethod).toBe('card');
    expect(state.subscription?.externalProductId).toBe('prod_mock_' + PLAN_ID);
    expect(state.plans.get(PLAN_ID)?.paymentProviderProductId).toBe('prod_mock_' + PLAN_ID);
    expect(state.workspace.subscriptionStatus).toBe('trial');

    state.subscription!.externalSubscriptionId = EXT_SUB;

    const completedBody = webhookPayload('checkout.completed');
    const completed = await postWebhook(app, completedBody);
    expect(completed.status).toBe(200);
    expect(state.workspace.subscriptionStatus).toBe('active');
    expect(state.subscription?.status).toBe('active');
    expect(state.workspace.trialEndsAt).toBeNull();
    expect(state.audits.some((a) => a.action === 'subscription.activated')).toBe(true);
    const periodAfterActivate = state.subscription?.currentPeriodEnd ?? null;
    expect(periodAfterActivate).toBeInstanceOf(Date);

    const renewedBody = webhookPayload('subscription.renewed');
    const renewed = await postWebhook(app, renewedBody);
    expect(renewed.status).toBe(200);
    expect(state.subscription?.status).toBe('active');
    expect(state.subscription?.currentPeriodEnd?.getTime()).toBeGreaterThan(
      periodAfterActivate!.getTime(),
    );
    expect(state.audits.some((a) => a.action === 'subscription.renewed')).toBe(true);

    const cancelledBody = webhookPayload('subscription.cancelled');
    const cancelled = await postWebhook(app, cancelledBody);
    expect(cancelled.status).toBe(200);
    expect(state.workspace.subscriptionStatus).toBe('canceled');
    expect(state.subscription?.status).toBe('canceled');
    expect(state.subscription?.canceledAt).toBeInstanceOf(Date);
    expect(state.subscription?.cancelAtPeriodEnd).toBe(true);

    const view = await request(app).get('/api/billing/subscription');
    expect(view.status).toBe(200);
    expect(view.body.subscription?.status).toBe('canceled');
    expect(view.body.subscription?.plan?.key).toBe('pro');
  });

  it('webhook SEM assinatura retorna 401 e nenhuma transicao', async () => {
    const app = await buildApp();
    state.subscription = { ...defaultSubFor(), externalSubscriptionId: EXT_SUB };
    const body = webhookPayload('checkout.completed');
    const res = await postWebhook(app, body, { withSecret: false });
    expect(res.status).toBe(401);
    expect(state.workspace.subscriptionStatus).toBe('trial');
    expect(state.subscription?.status).toBe('trial');
    expect(state.paymentEvents.size).toBe(0);
    expect(state.audits).toHaveLength(0);
  });

  it('replay do mesmo event id e no-op idempotente', async () => {
    const app = await buildApp();
    state.subscription = { ...defaultSubFor(), externalSubscriptionId: EXT_SUB };
    const body = webhookPayload('checkout.completed');

    const first = await postWebhook(app, body);
    expect(first.status).toBe(200);
    expect(state.workspace.subscriptionStatus).toBe('active');
    const auditsAfterFirst = state.audits.length;

    state.workspace.subscriptionStatus = 'past_due';

    const replay = await postWebhook(app, body);
    expect(replay.status).toBe(200);
    expect(state.workspace.subscriptionStatus).toBe('past_due');
    expect(state.audits.length).toBe(auditsAfterFirst);
  });

  it('plano e preco da transicao vem do nosso DB; payload forjado nao troca o plano', async () => {
    const app = await buildApp();
    state.subscription = { ...defaultSubFor(), externalSubscriptionId: EXT_SUB, planId: PLAN_ID };

    const body = webhookPayload('checkout.completed', {
      planId: OTHER_PLAN_ID,
      amount: 1,
      metadata: { workspaceId: WS_ID, planId: OTHER_PLAN_ID },
    });
    const res = await postWebhook(app, body);
    expect(res.status).toBe(200);
    expect(state.workspace.planId).toBe(PLAN_ID);
    expect(state.subscription?.planId).toBe(PLAN_ID);
  });
});
