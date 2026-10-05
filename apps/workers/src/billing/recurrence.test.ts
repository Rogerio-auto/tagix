import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { createLogger } from '@hm/logger';
import type {
  IPaymentProvider,
  PixChargeResult,
  CreatePixChargeInput,
} from '@hm/payments';
import {
  createBillingDbPort,
  dunningStage,
  expireTrials,
  pixChargeEventId,
  runRecurrenceTick,
  DEFAULT_DUNNING_POLICY,
  type BillingDbPort,
  type DunningPolicy,
  type PixSubscription,
  type RecurrenceDeps,
} from './recurrence';
import type { RedisLike } from '../flows/scheduler';
import { getWorkersMetricsRegistry } from '../observability/metrics';

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

/** Empresa em memória para a varredura de trials (F71-S06). */
interface FakeTrialWorkspace {
  id: string;
  status: string;
  trialEndsAt: Date | null;
}

/** DB port fake em memória: marcas de cobrança + transições registradas. */
function fakeDb(
  subs: PixSubscription[],
  trialWorkspaces: FakeTrialWorkspace[] = [],
): BillingDbPort & {
  charged: Set<string>;
  transitions: { id: string; next: string }[];
  cancellations: string[];
  trialWorkspaces: FakeTrialWorkspace[];
  trialAudits: string[];
} {
  const charged = new Set<string>();
  const transitions: { id: string; next: string }[] = [];
  const cancellations: string[] = [];
  const trialAudits: string[] = [];
  const vencido = (w: FakeTrialWorkspace, now: Date): boolean =>
    w.status === 'trial' && w.trialEndsAt !== null && w.trialEndsAt.getTime() <= now.getTime();
  return {
    charged,
    transitions,
    cancellations,
    trialWorkspaces,
    trialAudits,
    async listExpiredTrials(now, limit) {
      return trialWorkspaces
        .filter((w) => vencido(w, now))
        .slice(0, limit)
        .map((w) => ({ workspaceId: w.id, trialEndsAt: w.trialEndsAt ?? now }));
    },
    // Mesma semântica do port real: UPDATE condicional, auditoria só quando move.
    async expireTrial(trial, now) {
      const w = trialWorkspaces.find((x) => x.id === trial.workspaceId);
      if (!w || !vencido(w, now)) return false;
      w.status = 'expired';
      trialAudits.push(w.id);
      return true;
    },
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

function deps(
  subs: PixSubscription[],
  trialWorkspaces: FakeTrialWorkspace[] = [],
): RecurrenceDeps & {
  db: ReturnType<typeof fakeDb>;
  provider: ReturnType<typeof fakeProvider>;
} {
  const provider = fakeProvider();
  const db = fakeDb(subs, trialWorkspaces);
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

// ─── F71-S06: fim do trial ──────────────────────────────────────────────────────

/** Valor atual do contador `hm_billing_trial_expired_total`. */
async function trialExpiredCounter(): Promise<number> {
  const metric = getWorkersMetricsRegistry().getSingleMetric('hm_billing_trial_expired_total');
  if (!metric) return 0;
  const data = await metric.get();
  return data.values.reduce((acc, v) => acc + v.value, 0);
}

describe('runRecurrenceTick — trial vencido (F71-S06)', () => {
  const now = new Date('2099-03-01T12:00:00Z');

  it('trial vencido vira expired; rodar de novo não faz nada', async () => {
    const d = deps([], [
      { id: 'ws-vencido', status: 'trial', trialEndsAt: new Date(now.getTime() - DAY) },
      { id: 'ws-no-prazo', status: 'trial', trialEndsAt: new Date(now.getTime() + DAY) },
      { id: 'ws-cortesia', status: 'trial', trialEndsAt: null },
      { id: 'ws-pago', status: 'active', trialEndsAt: new Date(now.getTime() - DAY) },
    ]);
    const before = await trialExpiredCounter();

    const first = await runRecurrenceTick(d, { now });
    expect(first.trialExpired).toBe(1);
    expect(d.db.trialWorkspaces.map((w) => [w.id, w.status])).toEqual([
      ['ws-vencido', 'expired'],
      ['ws-no-prazo', 'trial'],
      ['ws-cortesia', 'trial'],
      ['ws-pago', 'active'],
    ]);
    expect(d.db.trialAudits).toEqual(['ws-vencido']);
    expect(await trialExpiredCounter()).toBe(before + 1);

    const second = await runRecurrenceTick(d, { now: new Date(now.getTime() + 60_000) });
    expect(second.trialExpired).toBe(0);
    expect(d.db.trialAudits).toEqual(['ws-vencido']);
    expect(await trialExpiredCounter()).toBe(before + 1);
  });

  it('sem o lock, nada expira', async () => {
    const d = deps([], [{ id: 'ws-x', status: 'trial', trialEndsAt: new Date(now.getTime() - DAY) }]);
    const res = await runRecurrenceTick({ ...d, redis: fakeRedis(null) }, { now });
    expect(res.ran).toBe(false);
    expect(d.db.trialWorkspaces[0]?.status).toBe('trial');
  });

  it('log do tick traz a contagem de trial_expired', async () => {
    const d = deps([], [{ id: 'ws-y', status: 'trial', trialEndsAt: new Date(now.getTime() - DAY) }]);
    const info = vi.spyOn(d.logger, 'info');
    await runRecurrenceTick(d, { now });
    expect(info).toHaveBeenCalledWith(
      'billing-recurrence: tick concluído',
      expect.objectContaining({ trialExpired: 1 }),
    );
    info.mockRestore();
  });

  it('falha numa empresa não impede as outras', async () => {
    const d = deps([], [
      { id: 'ws-bad', status: 'trial', trialEndsAt: new Date(now.getTime() - 2 * DAY) },
      { id: 'ws-ok', status: 'trial', trialEndsAt: new Date(now.getTime() - DAY) },
    ]);
    const orig = d.db.expireTrial.bind(d.db);
    d.db.expireTrial = vi.fn(async (t, n) => {
      if (t.workspaceId === 'ws-bad') throw new Error('boom');
      return orig(t, n);
    });
    const res = await runRecurrenceTick(d, { now });
    expect(res.trialExpired).toBe(1);
    expect(d.db.trialAudits).toEqual(['ws-ok']);
  });
});

/**
 * Port REAL contra o Postgres dev: `workspaces` + `subscriptions` + `audit_logs`. A varredura
 * é restrita à empresa do teste (`workspaceId`) para não mexer em dados de outros testes.
 */
describe.skipIf(!process.env['DATABASE_URL'])('expireTrials — port real (Postgres dev, F71-S06)', () => {
  const { workspaces, subscriptions, plans, auditLogs } = schema;
  const db = createBillingDbPort();
  const sfx = randomUUID().slice(0, 8);
  let wsVencido = '';
  let wsNoPrazo = '';
  let planId = '';

  beforeAll(async () => {
    const [plan] = await getDb()
      .insert(plans)
      .values({ key: `f71s06-${sfx}`, name: 'F71S06', priceMonthlyCents: 100 })
      .returning({ id: plans.id });
    if (!plan) throw new Error('plan');
    planId = plan.id;
    const ended = new Date(Date.now() - DAY);
    const [a] = await getDb()
      .insert(workspaces)
      .values({ name: 'Trial vencido', slug: `f71s06-v-${sfx}`, trialEndsAt: ended })
      .returning({ id: workspaces.id });
    const [b] = await getDb()
      .insert(workspaces)
      .values({
        name: 'Trial no prazo',
        slug: `f71s06-p-${sfx}`,
        trialEndsAt: new Date(Date.now() + 10 * DAY),
      })
      .returning({ id: workspaces.id });
    if (!a || !b) throw new Error('workspaces');
    wsVencido = a.id;
    wsNoPrazo = b.id;
    await getDb().insert(subscriptions).values([
      { workspaceId: wsVencido, planId, status: 'trial', trialEndsAt: ended },
      { workspaceId: wsNoPrazo, planId, status: 'trial', trialEndsAt: new Date(Date.now() + 10 * DAY) },
    ]);
  });

  afterAll(async () => {
    for (const id of [wsVencido, wsNoPrazo]) {
      if (id) await getDb().delete(workspaces).where(eq(workspaces.id, id));
    }
    if (planId) await getDb().delete(plans).where(eq(plans.id, planId));
    await closeDb();
  });

  async function state(workspaceId: string) {
    const [ws] = await getDb()
      .select({ status: workspaces.subscriptionStatus })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    const [sub] = await getDb()
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId));
    const audits = await getDb()
      .select({ id: auditLogs.id, metadata: auditLogs.metadata, actorType: auditLogs.actorType })
      .from(auditLogs)
      .where(
        and(eq(auditLogs.workspaceId, workspaceId), eq(auditLogs.action, 'billing.trial_expired')),
      );
    return { ws: ws?.status, sub: sub?.status, audits };
  }

  it('trial vencido vira expired (empresa + assinatura + auditoria); de novo, nada', async () => {
    const now = new Date();
    const d = { db, logger };

    expect(await expireTrials(d, { now, workspaceId: wsVencido })).toBe(1);
    const after = await state(wsVencido);
    expect(after.ws).toBe('expired');
    expect(after.sub).toBe('expired');
    expect(after.audits).toHaveLength(1);
    expect(after.audits[0]?.actorType).toBe('system');
    expect(after.audits[0]?.metadata).toMatchObject({ from: 'trial', to: 'expired' });

    expect(await expireTrials(d, { now, workspaceId: wsVencido })).toBe(0);
    expect((await state(wsVencido)).audits).toHaveLength(1);
  });

  it('trial no prazo não é tocado', async () => {
    expect(await expireTrials({ db, logger }, { now: new Date(), workspaceId: wsNoPrazo })).toBe(0);
    const s = await state(wsNoPrazo);
    expect(s.ws).toBe('trial');
    expect(s.sub).toBe('trial');
    expect(s.audits).toHaveLength(0);
  });

  it('extensão de trial entre a varredura e o UPDATE vence (UPDATE condicional)', async () => {
    const stale = { workspaceId: wsNoPrazo, trialEndsAt: new Date(Date.now() - DAY) };
    expect(await db.expireTrial(stale, new Date())).toBe(false);
    expect((await state(wsNoPrazo)).ws).toBe('trial');
  });
});
