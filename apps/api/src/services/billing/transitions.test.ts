/**
 * Testes do serviço de transições de assinatura (F41-S03).
 *
 * Puros (sem Postgres): injetamos `TransitionPorts` fakes determinísticos e
 * verificamos o mapa evento→transição da PAYMENTS_ABACATEPAY.md §4, mais as
 * regras duras: plano resolvido server-side (nunca do payload) e auditoria de
 * cada transição. Cada caso checa o patch aplicado E o before/after auditado.
 */
import { describe, it, expect, vi } from 'vitest';
import type { WebhookEvent } from '@hm/payments';
import {
  applyTransition,
  classifyEvent,
  eventTypeOf,
  resolveExternalSubscriptionId,
  resolveWorkspaceIdFromMetadata,
  type SubscriptionSnapshot,
  type TransitionPorts,
  type WorkspaceSnapshot,
} from './transitions';

const WS_ID = '11111111-1111-1111-1111-111111111111';
const PLAN_ID = '22222222-2222-2222-2222-222222222222';
const EXT_SUB = 'sub_ext_abc';

function makeSub(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    workspaceId: WS_ID,
    planId: PLAN_ID,
    status: 'trial',
    currentPeriodEnd: null,
    paymentMethod: 'card',
    ...overrides,
  };
}

function makeWs(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    id: WS_ID,
    planId: PLAN_ID,
    status: 'trial',
    trialEndsAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

interface Capture {
  applied: Parameters<TransitionPorts['applyTransition']>[0][];
  audits: Parameters<TransitionPorts['recordAudit']>[0][];
}

function makePorts(opts: {
  sub?: SubscriptionSnapshot | null;
  subByWorkspace?: SubscriptionSnapshot | null;
  ws?: WorkspaceSnapshot | null;
  planActive?: boolean;
}): { ports: TransitionPorts; capture: Capture } {
  const capture: Capture = { applied: [], audits: [] };
  const ports: TransitionPorts = {
    findSubscriptionByExternalId: vi.fn(async () => opts.sub ?? null),
    findSubscriptionByWorkspace: vi.fn(async () => opts.subByWorkspace ?? null),
    getWorkspace: vi.fn(async () => (opts.ws === undefined ? makeWs() : opts.ws)),
    isPlanActive: vi.fn(async () => opts.planActive ?? true),
    applyTransition: vi.fn(async (input) => {
      capture.applied.push(input);
    }),
    recordAudit: vi.fn(async (input) => {
      capture.audits.push(input);
    }),
  };
  return { ports, capture };
}

function event(type: string, data: Record<string, unknown> = {}): WebhookEvent {
  return { id: `evt_${type}`, event: type, data } as WebhookEvent;
}

describe('classifyEvent', () => {
  it('mapeia checkout/subscription completed → activate', () => {
    expect(classifyEvent('checkout.completed')).toBe('activate');
    expect(classifyEvent('subscription.completed')).toBe('activate');
    expect(classifyEvent('billing.subscription.completed')).toBe('activate');
  });
  it('mapeia renewed → renew', () => {
    expect(classifyEvent('subscription.renewed')).toBe('renew');
  });
  it('mapeia cancelled → cancel', () => {
    expect(classifyEvent('subscription.cancelled')).toBe('cancel');
    expect(classifyEvent('subscription.canceled')).toBe('cancel');
  });
  it('mapeia refund/dispute/lost → past_due (avaliado antes de completed)', () => {
    expect(classifyEvent('payment.refunded')).toBe('past_due');
    expect(classifyEvent('charge.disputed')).toBe('past_due');
    expect(classifyEvent('payment.chargeback')).toBe('past_due');
    expect(classifyEvent('subscription.lost')).toBe('past_due');
  });
  it('desconhecido / vazio → ignore', () => {
    expect(classifyEvent('')).toBe('ignore');
    expect(classifyEvent('contact.created')).toBe('ignore');
  });
});

describe('helpers de extração', () => {
  it('eventTypeOf tolera event/type e normaliza minúsculas', () => {
    expect(eventTypeOf({ event: 'Checkout.Completed' } as WebhookEvent)).toBe('checkout.completed');
    expect(eventTypeOf({ type: 'subscription.renewed' } as WebhookEvent)).toBe(
      'subscription.renewed',
    );
  });
  it('resolveExternalSubscriptionId tolera nomes de campo', () => {
    expect(resolveExternalSubscriptionId(event('x', { subscriptionId: 's1' }))).toBe('s1');
    expect(resolveExternalSubscriptionId(event('x', { subscription_id: 's2' }))).toBe('s2');
    expect(resolveExternalSubscriptionId(event('x', { id: 's3' }))).toBe('s3');
    expect(resolveExternalSubscriptionId(event('x', {}))).toBeNull();
  });
  it('resolveWorkspaceIdFromMetadata lê de metadata que NÓS gravamos', () => {
    expect(resolveWorkspaceIdFromMetadata(event('x', { metadata: { workspaceId: WS_ID } }))).toBe(
      WS_ID,
    );
  });
});

describe('applyTransition — mapa §4', () => {
  it('checkout.completed → active, encerra trial, audita before/after', async () => {
    const { ports, capture } = makePorts({ sub: makeSub(), ws: makeWs() });
    const out = await applyTransition(event('checkout.completed', { id: EXT_SUB }), ports);

    expect(out).toMatchObject({ kind: 'applied', status: 'active', workspaceId: WS_ID });
    expect(capture.applied).toHaveLength(1);
    const patch = capture.applied[0]?.patch;
    expect(patch?.status).toBe('active');
    expect(patch?.planId).toBe(PLAN_ID);
    expect(patch?.trialEndsAt).toBeNull();
    expect(patch?.currentPeriodEnd).toBeInstanceOf(Date);
    expect(capture.audits[0]?.action).toBe('subscription.activated');
    expect(capture.audits[0]?.before).toMatchObject({ status: 'trial' });
    expect(capture.audits[0]?.after).toMatchObject({ status: 'active' });
  });

  it('subscription.completed → active (plano resolvido server-side)', async () => {
    const { ports, capture } = makePorts({ sub: makeSub(), ws: makeWs() });
    const out = await applyTransition(event('subscription.completed', { id: EXT_SUB }), ports);
    expect(out).toMatchObject({ kind: 'applied', status: 'active' });
    expect(capture.applied[0]?.patch.planId).toBe(PLAN_ID);
  });

  it('activate com plano inativo → unresolved (não aplica)', async () => {
    const { ports, capture } = makePorts({ sub: makeSub(), ws: makeWs(), planActive: false });
    const out = await applyTransition(event('checkout.completed', { id: EXT_SUB }), ports);
    expect(out).toMatchObject({ kind: 'unresolved', reason: 'plan_inactive_or_missing' });
    expect(capture.applied).toHaveLength(0);
  });

  it('subscription.renewed → mantém active e avança current_period_end', async () => {
    const prev = new Date('2026-07-01T00:00:00Z');
    const { ports, capture } = makePorts({
      sub: makeSub({ status: 'active', currentPeriodEnd: prev }),
      ws: makeWs({ status: 'active', trialEndsAt: null }),
    });
    const out = await applyTransition(event('subscription.renewed', { id: EXT_SUB }), ports);
    expect(out).toMatchObject({ kind: 'applied', status: 'active' });
    const patch = capture.applied[0]?.patch;
    expect(patch?.status).toBe('active');
    expect(patch?.currentPeriodEnd?.getTime()).toBeGreaterThan(prev.getTime());
    expect(capture.audits[0]?.action).toBe('subscription.renewed');
  });

  it('subscription.cancelled → canceled, carimba canceled_at', async () => {
    const { ports, capture } = makePorts({
      sub: makeSub({ status: 'active' }),
      ws: makeWs({ status: 'active' }),
    });
    const out = await applyTransition(event('subscription.cancelled', { id: EXT_SUB }), ports);
    expect(out).toMatchObject({ kind: 'applied', status: 'canceled' });
    const patch = capture.applied[0]?.patch;
    expect(patch?.status).toBe('canceled');
    expect(patch?.canceledAt).toBeInstanceOf(Date);
    expect(capture.audits[0]?.action).toBe('subscription.canceled');
  });

  it('payment.refunded → past_due (revisão, auditado)', async () => {
    const { ports, capture } = makePorts({
      sub: makeSub({ status: 'active' }),
      ws: makeWs({ status: 'active' }),
    });
    const out = await applyTransition(event('payment.refunded', { id: EXT_SUB }), ports);
    expect(out).toMatchObject({ kind: 'applied', status: 'past_due' });
    expect(capture.applied[0]?.patch.status).toBe('past_due');
    expect(capture.audits[0]?.action).toBe('subscription.payment_disputed');
  });

  it('evento não mapeado → ignored, sem efeito', async () => {
    const { ports, capture } = makePorts({ sub: makeSub(), ws: makeWs() });
    const out = await applyTransition(event('contact.created', { id: EXT_SUB }), ports);
    expect(out).toMatchObject({ kind: 'ignored' });
    expect(capture.applied).toHaveLength(0);
    expect(capture.audits).toHaveLength(0);
  });

  it('sem assinatura correlacionável → unresolved, sem efeito', async () => {
    const { ports, capture } = makePorts({ sub: null, subByWorkspace: null });
    const out = await applyTransition(event('checkout.completed', { id: EXT_SUB }), ports);
    expect(out).toMatchObject({ kind: 'unresolved' });
    expect(capture.applied).toHaveLength(0);
  });

  it('fallback por metadata.workspaceId quando não há id externo conhecido', async () => {
    const { ports } = makePorts({ sub: null, subByWorkspace: makeSub(), ws: makeWs() });
    const out = await applyTransition(
      event('checkout.completed', { metadata: { workspaceId: WS_ID } }),
      ports,
    );
    expect(out).toMatchObject({ kind: 'applied', status: 'active' });
  });

  it('NUNCA confia em plano do payload: usa o plano da NOSSA assinatura', async () => {
    const { ports, capture } = makePorts({ sub: makeSub({ planId: PLAN_ID }), ws: makeWs() });
    // payload tenta injetar outro plano — deve ser ignorado.
    const out = await applyTransition(
      event('checkout.completed', { id: EXT_SUB, planId: 'malicious-plan', amount: 999999 }),
      ports,
    );
    expect(out).toMatchObject({ kind: 'applied' });
    expect(capture.applied[0]?.patch.planId).toBe(PLAN_ID);
  });
});
