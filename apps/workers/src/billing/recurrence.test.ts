import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@hm/logger';
import type {
  IPaymentProvider,
  PixChargeResult,
  CreatePixChargeInput,
} from '@hm/payments';
import {
  dunningStage,
  pixChargeEventId,
  runRecurrenceTick,
  DEFAULT_DUNNING_POLICY,
  type BillingDbPort,
  type DunningPolicy,
  type PixSubscription,
  type RecurrenceDeps,
} from './recurrence';
import type { RedisLike } from '../flows/scheduler';

const logger = createLogger('error');
const DAY = 24 * 60 * 60 * 1000;

const policy: DunningPolicy = {
  leadDays: 3,
  graceDays: 3,
  pastDueDays: 7,
  pixExpiresInSeconds: 100,
};

const WS = '11111111-1111-1111-1111-111111111111';

/** Redis fake: lock adquirido por default. */
function fakeRedis(setResult: 'OK' | null = 'OK'): RedisLike {
  return {
    set: vi.fn(async () => setResult),
    eval: vi.fn(async () => 1),
  };
}

function sub(overrides: Partial<PixSubscription> = {}): PixSubscription {
  return {
    subscriptionId: 'sub-1',
    workspaceId: WS,
    planId: 'plan-1',
    status: 'active',
    billingCycle: 'monthly',
    currentPeriodEnd: new Date('2099-02-01T00:00:00Z'),
    cancelAtPeriodEnd: false,
    externalCustomerId: 'cus_1',
    externalProductId: 'prod_1',
    ...overrides,
  };
}

/** Provider fake que registra as cobranças criadas. */
function fakeProvider(): IPaymentProvider & { charges: CreatePixChargeInput[] } {
  const charges: CreatePixChargeInput[] = [];
  const provider = {
    id: 'mock',
    charges,
    async ensureProduct() {
      throw new Error('unused');
    },
    async ensureCustomer() {
      throw new Error('unused');
    },
    async createHostedCheckout() {
      throw new Error('unused');
    },
    async createSubscription() {
      throw new Error('unused');
    },
    async createPixCharge(input: CreatePixChargeInput): Promise<PixChargeResult> {
      charges.push(input);
      return {
        externalId: `pix_${charges.length}`,
        status: 'pending',
        amountCents: input.amountCents,
      };
    },
    async cancelSubscription() {
      /* no-op */
    },
    async getSubscription() {
      throw new Error('unused');
    },
  } as IPaymentProvider & { charges: CreatePixChargeInput[] };
  return provider;
}

/** DB port fake em memória: marcas de cobrança + transições registradas. */
function fakeDb(subs: PixSubscription[]): BillingDbPort & {
  charged: Set<string>;
  transitions: { id: string; next: string }[];
  cancellations: string[];
} {
  const charged = new Set<string>();
  const transitions: { id: string; next: string }[] = [];
  const cancellations: string[] = [];
  return {
    charged,
    transitions,
    cancellations,
    async listActionablePixSubscriptions() {
      return subs;
    },
    async loadPlan(_ws, planId) {
      return { id: planId, name: 'Pro', priceMonthlyCents: 9900, priceYearlyCents: 99000 };
    },
    async loadWorkspace(workspaceId) {
      return { id: workspaceId, name: 'Acme', billingEmail: 'b@acme.test' };
    },
    async chargeAlreadyMade(s) {
      if (s.currentPeriodEnd === null) return true;
      return charged.has(pixChargeEventId(s.subscriptionId, s.currentPeriodEnd));
    },
    async recordCharge(s) {
      if (s.currentPeriodEnd === null) return;
      charged.add(pixChargeEventId(s.subscriptionId, s.currentPeriodEnd));
    },
    async transitionStatus(s, next) {
      transitions.push({ id: s.subscriptionId, next });
    },
    async finalizeCancellation(s) {
      cancellations.push(s.subscriptionId);
    },
  };
}

function deps(subs: PixSubscription[]): RecurrenceDeps & {
  db: ReturnType<typeof fakeDb>;
  provider: ReturnType<typeof fakeProvider>;
} {
  const provider = fakeProvider();
  const db = fakeDb(subs);
  return { redis: fakeRedis(), provider, db, logger, policy };
}

describe('dunningStage', () => {
  const end = new Date('2099-02-01T00:00:00Z');

  it('none: longe do vencimento', () => {
    const now = new Date(end.getTime() - 10 * DAY);
    expect(dunningStage({ currentPeriodEnd: end, cancelAtPeriodEnd: false, status: 'active' }, now, policy)).toBe('none');
  });

  it('charge: dentro da janela de lead (<= leadDays antes do vencimento)', () => {
    const now = new Date(end.getTime() - 2 * DAY);
    expect(dunningStage({ currentPeriodEnd: end, cancelAtPeriodEnd: false, status: 'active' }, now, policy)).toBe('charge');
  });

  it('grace: vencido mas dentro da tolerância', () => {
    const now = new Date(end.getTime() + 1 * DAY);
    expect(dunningStage({ currentPeriodEnd: end, cancelAtPeriodEnd: false, status: 'active' }, now, policy)).toBe('grace');
  });

  it('past_due: tolerância estourada', () => {
    const now = new Date(end.getTime() + (policy.graceDays + 1) * DAY);
    expect(dunningStage({ currentPeriodEnd: end, cancelAtPeriodEnd: false, status: 'active' }, now, policy)).toBe('past_due');
  });

  it('cutoff: past_due estourado', () => {
    const now = new Date(end.getTime() + (policy.graceDays + policy.pastDueDays + 1) * DAY);
    expect(dunningStage({ currentPeriodEnd: end, cancelAtPeriodEnd: false, status: 'past_due' }, now, policy)).toBe('cutoff');
  });

  it('cancel: cancel_at_period_end com período encerrado vence tudo', () => {
    const now = new Date(end.getTime() + 1 * DAY);
    expect(dunningStage({ currentPeriodEnd: end, cancelAtPeriodEnd: true, status: 'active' }, now, policy)).toBe('cancel');
  });

  it('none: já cancelada/expirada não re-transiciona', () => {
    const now = new Date(end.getTime() + 100 * DAY);
    expect(dunningStage({ currentPeriodEnd: end, cancelAtPeriodEnd: false, status: 'canceled' }, now, policy)).toBe('none');
  });

  it('none: sem ciclo ativo', () => {
    expect(dunningStage({ currentPeriodEnd: null, cancelAtPeriodEnd: false, status: 'active' }, new Date(), policy)).toBe('none');
  });
});

describe('runRecurrenceTick', () => {
  const end = new Date('2099-02-01T00:00:00Z');
  const inLead = new Date(end.getTime() - 2 * DAY);

  it('não roda quando o lock é detido por outra instância', async () => {
    const d = deps([sub()]);
    const res = await runRecurrenceTick({ ...d, redis: fakeRedis(null) });
    expect(res.ran).toBe(false);
    expect(d.provider.charges).toHaveLength(0);
  });

  it('gera UMA cobrança PIX no lead e marca o ciclo', async () => {
    const d = deps([sub()]);
    const res = await runRecurrenceTick(d, { now: inLead });
    expect(res.charged).toBe(1);
    expect(d.provider.charges).toHaveLength(1);
    expect(d.provider.charges[0]?.amountCents).toBe(9900);
    expect(d.db.charged.has(pixChargeEventId('sub-1', end))).toBe(true);
  });

  it('idempotência por ciclo: 2 ticks no mesmo período cobram só 1×', async () => {
    const d = deps([sub()]);
    await runRecurrenceTick(d, { now: inLead });
    const res2 = await runRecurrenceTick(d, { now: new Date(inLead.getTime() + 60_000) });
    expect(d.provider.charges).toHaveLength(1);
    expect(res2.charged).toBe(0);
    expect(res2.skippedAlreadyCharged).toBe(1);
  });

  it('cobrança anual usa o preço anual', async () => {
    const d = deps([sub({ billingCycle: 'yearly' })]);
    await runRecurrenceTick(d, { now: inLead });
    expect(d.provider.charges[0]?.amountCents).toBe(99000);
  });

  it('tolerância (grace): não cobra de novo nem degrada o status', async () => {
    const d = deps([sub({ status: 'active' })]);
    const res = await runRecurrenceTick(d, { now: new Date(end.getTime() + 1 * DAY) });
    expect(res.charged).toBe(0);
    expect(res.pastDue).toBe(0);
    expect(d.db.transitions).toHaveLength(0);
  });

  it('transiciona para past_due quando a tolerância estoura', async () => {
    const d = deps([sub({ status: 'active' })]);
    const res = await runRecurrenceTick(d, { now: new Date(end.getTime() + (policy.graceDays + 1) * DAY) });
    expect(res.pastDue).toBe(1);
    expect(d.db.transitions).toEqual([{ id: 'sub-1', next: 'past_due' }]);
  });

  it('past_due é idempotente: não re-transiciona quem já está past_due', async () => {
    const d = deps([sub({ status: 'past_due' })]);
    const res = await runRecurrenceTick(d, { now: new Date(end.getTime() + (policy.graceDays + 1) * DAY) });
    expect(res.pastDue).toBe(0);
    expect(d.db.transitions).toHaveLength(0);
  });

  it('corte: cancela por inadimplência quando past_due estoura', async () => {
    const d = deps([sub({ status: 'past_due' })]);
    const cutoffNow = new Date(end.getTime() + (policy.graceDays + policy.pastDueDays + 1) * DAY);
    const res = await runRecurrenceTick(d, { now: cutoffNow });
    expect(res.cutoff).toBe(1);
    expect(d.db.transitions).toEqual([{ id: 'sub-1', next: 'canceled' }]);
  });

  it('cancel_at_period_end: finaliza no fim do período sem gerar cobrança', async () => {
    const d = deps([sub({ cancelAtPeriodEnd: true })]);
    const res = await runRecurrenceTick(d, { now: new Date(end.getTime() + 1 * DAY) });
    expect(res.canceled).toBe(1);
    expect(d.provider.charges).toHaveLength(0);
    expect(d.db.cancellations).toEqual(['sub-1']);
  });

  it('uma assinatura com erro não derruba as demais', async () => {
    const d = deps([sub({ subscriptionId: 'sub-bad' }), sub({ subscriptionId: 'sub-ok' })]);
    const orig = d.db.transitionStatus.bind(d.db);
    d.db.transitionStatus = vi.fn(async (s, next, reason, now) => {
      if (s.subscriptionId === 'sub-bad') throw new Error('boom');
      return orig(s, next, reason, now);
    });
    const res = await runRecurrenceTick(d, { now: new Date(end.getTime() + (policy.graceDays + 1) * DAY) });
    expect(res.inspected).toBe(2);
    expect(res.pastDue).toBe(1);
    expect(d.db.transitions).toEqual([{ id: 'sub-ok', next: 'past_due' }]);
  });

  it('default policy expira PIX com folga (lead+grace+pastDue)', () => {
    expect(DEFAULT_DUNNING_POLICY.pixExpiresInSeconds).toBeGreaterThan(
      (DEFAULT_DUNNING_POLICY.graceDays + DEFAULT_DUNNING_POLICY.pastDueDays) * 24 * 60 * 60,
    );
  });
});
