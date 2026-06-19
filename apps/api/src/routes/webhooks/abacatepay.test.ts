/**
 * Testes do webhook AbacatePay (F41-S03 DoD).
 *
 * Cobre o contrato de segurança + idempotência sem Postgres real: `@hm/db` é
 * mockado por um fake stateful que encena os builders Drizzle usados pela rota e
 * pela dedup de borda. Casos:
 *   - assinatura ausente / inválida → 401, sem efeito (nenhum insert)
 *   - assinatura válida → 200 + transição aplicada (workspace+subscription+audit)
 *   - replay do mesmo event id → no-op idempotente (transição não re-aplica)
 *   - cada transição (completed/renewed/cancelled/refunded)
 *
 * O HMAC é o real do `@hm/payments` (não mockado) — garante que o raw body é o
 * que verificamos. O secret vem de ABACATEPAY_WEBHOOK_SECRET (setado no teste).
 */
import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'test_webhook_secret_value';
process.env['ABACATEPAY_WEBHOOK_SECRET'] = SECRET;

// ─── Fake stateful de @hm/db ──────────────────────────────────────────────────
// Tabelas de interesse: webhook_events (dedup de borda) e payment_events (ledger
// de domínio) são append-only com índice único; subscriptions/workspaces/plans
// são linhas únicas mutáveis; audit_logs acumula.

interface FakeState {
  webhookEvents: Set<string>; // chave provider|eventId
  paymentEvents: Map<string, { id: string; processedAt: Date | null; status: string | null; workspaceId: string | null }>;
  workspace: { id: string; planId: string | null; subscriptionStatus: string; trialEndsAt: Date | null };
  subscription: {
    workspaceId: string;
    planId: string | null;
    status: string;
    currentPeriodEnd: Date | null;
    canceledAt: Date | null;
    cancelAtPeriodEnd: boolean;
    externalSubscriptionId: string | null;
    paymentMethod: string | null;
  };
  plan: { id: string; isActive: boolean };
  audits: { action: string; metadata: Record<string, unknown> }[];
}

const WS_ID = '11111111-1111-1111-1111-111111111111';
const PLAN_ID = '22222222-2222-2222-2222-222222222222';
const EXT_SUB = 'sub_ext_abc';

let state: FakeState;

function freshState(): FakeState {
  return {
    webhookEvents: new Set(),
    paymentEvents: new Map(),
    workspace: { id: WS_ID, planId: PLAN_ID, subscriptionStatus: 'trial', trialEndsAt: new Date() },
    subscription: {
      workspaceId: WS_ID,
      planId: PLAN_ID,
      status: 'trial',
      currentPeriodEnd: null,
      canceledAt: null,
      cancelAtPeriodEnd: false,
      externalSubscriptionId: EXT_SUB,
      paymentMethod: 'card',
    },
    plan: { id: PLAN_ID, isActive: true },
    audits: [],
  };
}

// Tokens-objeto que representam cada "tabela". Cada coluna usada pela rota é uma
// propriedade que carrega `{ __name }` da tabela + o nome da coluna — assim
// `schema.X.col` é um Predicate-builder válido para o `eq` mockado, e o fake DB
// despacha pela tabela via `table.__name`.
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

// `eq`/`and` mockados capturam (coluna, valor). O fake DB interpreta a intenção
// pela tabela do `.from`/`.update` (via `table.__name`).
interface Predicate {
  col: string;
  val: unknown;
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
                    const key = `${String(vals['provider'])}|${String(vals['externalEventId'])}`;
                    if (state.webhookEvents.has(key)) return [];
                    state.webhookEvents.add(key);
                    return [{ id: 'we_1' }];
                  }
                  if (table === TBL.paymentEvents) {
                    const key = `${String(vals['provider'])}|${String(vals['externalEventId'])}`;
                    if (state.paymentEvents.has(key)) return [];
                    const id = `pe_${state.paymentEvents.size + 1}`;
                    state.paymentEvents.set(key, { id, processedAt: null, status: null, workspaceId: null });
                    return [{ id }];
                  }
                  return [];
                },
              };
            },
            // audit_logs.insert(...).values(...) sem onConflict → thenable.
            async then(resolve: (v: unknown) => void) {
              if (table === TBL.auditLogs) {
                state.audits.push({
                  action: String(vals['action']),
                  metadata: (vals['metadata'] as Record<string, unknown>) ?? {},
                });
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
            async limit() {
              return runSelect(table, preds);
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

function runSelect(table: TableName, preds: Predicate[]): unknown[] {
  if (table === TBL.subscriptions) {
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
    return [{ isActive: state.plan.isActive }];
  }
  if (table === TBL.paymentEvents) {
    const byEvent = preds.find((p) => p.col === 'externalEventId');
    for (const [key, row] of state.paymentEvents) {
      if (!byEvent || key.endsWith(`|${String(byEvent.val)}`)) {
        return [{ id: row.id, processedAt: row.processedAt }];
      }
    }
    return [];
  }
  return [];
}

function applyUpdate(table: TableName, pred: Predicate, vals: Record<string, unknown>): void {
  if (table === TBL.workspaces) {
    if ('subscriptionStatus' in vals) state.workspace.subscriptionStatus = String(vals['subscriptionStatus']);
    if ('planId' in vals) state.workspace.planId = (vals['planId'] as string | null) ?? null;
    if ('trialEndsAt' in vals) state.workspace.trialEndsAt = (vals['trialEndsAt'] as Date | null) ?? null;
  } else if (table === TBL.subscriptions) {
    if ('status' in vals) state.subscription.status = String(vals['status']);
    if ('currentPeriodEnd' in vals) state.subscription.currentPeriodEnd = (vals['currentPeriodEnd'] as Date | null) ?? null;
    if ('canceledAt' in vals) state.subscription.canceledAt = (vals['canceledAt'] as Date | null) ?? null;
    if ('cancelAtPeriodEnd' in vals) state.subscription.cancelAtPeriodEnd = Boolean(vals['cancelAtPeriodEnd']);
  } else if (table === TBL.paymentEvents) {
    // update por id (pred.col === 'id'): carimba processed_at/status/workspace.
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
    ]),
    subscriptions: makeTable('subscriptions', ['workspaceId', 'externalSubscriptionId']),
    workspaces: makeTable('workspaces', ['id']),
    plans: makeTable('plans', ['id', 'isActive']),
    auditLogs: makeTable('audit_logs', []),
  },
}));

// `eq`/`and` retornam Predicate(s) que o fake interpreta. `eq` recebe a coluna
// (`{ col }`) e o valor.
vi.mock('drizzle-orm', () => ({
  eq: (col: { col: string }, val: unknown) => ({ col: col.col, val }),
  and: (...preds: unknown[]) => preds,
}));

// Logger silencioso.
vi.mock('@hm/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { createAbacatePayWebhookRouter } = await import('./abacatepay');

function buildApp() {
  const app = express();
  app.use(createAbacatePayWebhookRouter());
  app.use(express.json());
  return app;
}

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('hex')}`;
}

function payload(eventType: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: `evt_${eventType}_${Math.random().toString(36).slice(2)}`,
    event: eventType,
    data: { id: EXT_SUB, ...extra },
  });
}

beforeEach(() => {
  state = freshState();
});

describe('POST /webhooks/abacatepay — segurança HMAC', () => {
  it('rejeita 401 sem header de assinatura', async () => {
    const body = payload('checkout.completed');
    const res = await request(buildApp())
      .post('/webhooks/abacatepay')
      .set('content-type', 'application/json')
      .send(body);
    expect(res.status).toBe(401);
    expect(state.workspace.subscriptionStatus).toBe('trial');
    expect(state.paymentEvents.size).toBe(0);
  });

  it('rejeita 401 com assinatura de segredo errado', async () => {
    const body = payload('checkout.completed');
    const res = await request(buildApp())
      .post('/webhooks/abacatepay')
      .set('content-type', 'application/json')
      .set('x-abacatepay-signature', sign(body, 'wrong_secret'))
      .send(body);
    expect(res.status).toBe(401);
    expect(state.workspace.subscriptionStatus).toBe('trial');
  });

  it('rejeita 401 com corpo adulterado após assinar', async () => {
    const body = payload('checkout.completed');
    const res = await request(buildApp())
      .post('/webhooks/abacatepay')
      .set('content-type', 'application/json')
      .set('x-abacatepay-signature', sign(body))
      .send(body + ' ');
    expect(res.status).toBe(401);
  });
});

async function post(app: express.Express, body: string) {
  return request(app)
    .post('/webhooks/abacatepay')
    .set('content-type', 'application/json')
    .set('x-abacatepay-signature', sign(body))
    .send(body);
}

describe('POST /webhooks/abacatepay — transições §4', () => {
  it('checkout.completed → active + audit', async () => {
    const res = await post(buildApp(), payload('checkout.completed'));
    expect(res.status).toBe(200);
    expect(state.workspace.subscriptionStatus).toBe('active');
    expect(state.subscription.status).toBe('active');
    expect(state.workspace.trialEndsAt).toBeNull();
    expect(state.audits.some((a) => a.action === 'subscription.activated')).toBe(true);
    // payment_events processado.
    const pe = [...state.paymentEvents.values()][0];
    expect(pe?.processedAt).toBeInstanceOf(Date);
    expect(pe?.status).toBe('active');
  });

  it('subscription.renewed → active e avança current_period_end', async () => {
    state.subscription.status = 'active';
    state.workspace.subscriptionStatus = 'active';
    const before = new Date('2026-07-01T00:00:00Z');
    state.subscription.currentPeriodEnd = before;
    const res = await post(buildApp(), payload('subscription.renewed'));
    expect(res.status).toBe(200);
    expect(state.subscription.status).toBe('active');
    expect(state.subscription.currentPeriodEnd?.getTime()).toBeGreaterThan(before.getTime());
    expect(state.audits.some((a) => a.action === 'subscription.renewed')).toBe(true);
  });

  it('subscription.cancelled → canceled + canceled_at', async () => {
    state.subscription.status = 'active';
    state.workspace.subscriptionStatus = 'active';
    const res = await post(buildApp(), payload('subscription.cancelled'));
    expect(res.status).toBe(200);
    expect(state.workspace.subscriptionStatus).toBe('canceled');
    expect(state.subscription.status).toBe('canceled');
    expect(state.subscription.canceledAt).toBeInstanceOf(Date);
    expect(state.subscription.cancelAtPeriodEnd).toBe(true);
  });

  it('payment.refunded → past_due', async () => {
    state.subscription.status = 'active';
    state.workspace.subscriptionStatus = 'active';
    const res = await post(buildApp(), payload('payment.refunded'));
    expect(res.status).toBe(200);
    expect(state.workspace.subscriptionStatus).toBe('past_due');
    expect(state.subscription.status).toBe('past_due');
    expect(state.audits.some((a) => a.action === 'subscription.payment_disputed')).toBe(true);
  });

  it('evento não mapeado → 200 sem transição', async () => {
    const res = await post(buildApp(), payload('contact.created'));
    expect(res.status).toBe(200);
    expect(state.workspace.subscriptionStatus).toBe('trial');
    expect(state.audits).toHaveLength(0);
  });
});

describe('POST /webhooks/abacatepay — idempotência', () => {
  it('replay do mesmo event id é no-op (transição não re-aplica)', async () => {
    const app = buildApp();
    const body = payload('checkout.completed');

    const first = await post(app, body);
    expect(first.status).toBe(200);
    expect(state.workspace.subscriptionStatus).toBe('active');
    const auditsAfterFirst = state.audits.length;

    // Adultera o estado para detectar re-processamento indevido.
    state.workspace.subscriptionStatus = 'past_due';

    const replay = await post(app, body);
    expect(replay.status).toBe(200);
    // Não re-transicionou (dedup de borda + payment_events.processed_at).
    expect(state.workspace.subscriptionStatus).toBe('past_due');
    expect(state.audits.length).toBe(auditsAfterFirst);
  });
});
