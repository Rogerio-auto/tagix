/**
 * F71-S06 — portão de assinatura dos workers de saída.
 *
 * 1) Puro: status efetivo, decisão, memo por tick, métrica.
 * 2) Postgres dev: o portão real lê `workspaces` a cada `check` (sem cache entre jobs).
 * 3) Inbound: o caminho de entrada NÃO passa pelo portão — empresa `expired` continua
 *    gravando a mensagem que chega (`DbInboundPersistence` real), e nenhum módulo de
 *    `inbound/` importa o portão.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema } from '@hm/db';
import { createLogger } from '@hm/logger';
import type { InboundEvent } from '@hm/channels';
import { getWorkersMetricsRegistry } from '../observability/metrics';
import { DbInboundPersistence, type InboundSocketPort } from '../inbound/db-ports';
import type { StatusDeps } from '../inbound/status';
import {
  createSubscriptionGate,
  effectiveSubscriptionStatus,
  memoizeSubscriptionGate,
  recordSubscriptionSkip,
  subscriptionGate,
  type LoadWorkspaceSubscription,
} from './subscription-gate';

const DAY = 24 * 60 * 60 * 1000;
const url = process.env['DATABASE_URL'];
const logger = createLogger('error');

// ─── 1) Puro ───────────────────────────────────────────────────────────────────

describe('effectiveSubscriptionStatus', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');
  it('trial vencido (ou vencendo agora) é expired; no prazo ou sem data segue trial', () => {
    expect(effectiveSubscriptionStatus('trial', new Date(now.getTime() - 1), now)).toBe('expired');
    expect(effectiveSubscriptionStatus('trial', now, now)).toBe('expired');
    expect(effectiveSubscriptionStatus('trial', new Date(now.getTime() + DAY), now)).toBe('trial');
    expect(effectiveSubscriptionStatus('trial', null, now)).toBe('trial');
    expect(effectiveSubscriptionStatus('past_due', null, now)).toBe('past_due');
  });
});

describe('createSubscriptionGate', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');
  const gateFor = (row: Awaited<ReturnType<LoadWorkspaceSubscription>>) =>
    createSubscriptionGate({ load: async () => row, now: () => now });

  it('active, trial no prazo e past_due podem enviar', async () => {
    for (const subscriptionStatus of ['active', 'past_due']) {
      expect(await gateFor({ subscriptionStatus, trialEndsAt: null }).check('w')).toEqual({
        active: true,
        status: subscriptionStatus,
      });
    }
    expect(
      (
        await gateFor({
          subscriptionStatus: 'trial',
          trialEndsAt: new Date(now.getTime() + DAY),
        }).check('w')
      ).active,
    ).toBe(true);
  });

  it('expired, canceled e trial vencido não podem', async () => {
    expect(await gateFor({ subscriptionStatus: 'expired', trialEndsAt: null }).check('w')).toEqual({
      active: false,
      status: 'expired',
    });
    expect(
      (await gateFor({ subscriptionStatus: 'canceled', trialEndsAt: null }).check('w')).active,
    ).toBe(false);
    expect(
      await gateFor({
        subscriptionStatus: 'trial',
        trialEndsAt: new Date(now.getTime() - DAY),
      }).check('w'),
    ).toEqual({ active: false, status: 'expired' });
  });

  it('empresa inexistente → inativa (fail-closed)', async () => {
    expect(await gateFor(null).check('w')).toEqual({ active: false, status: 'not_found' });
  });
});

describe('memoizeSubscriptionGate', () => {
  it('uma leitura por empresa dentro do mesmo tick', async () => {
    const check = vi.fn(async () => ({ active: true as const, status: 'active' }));
    const memo = memoizeSubscriptionGate({ check });
    await Promise.all([memo.check('a'), memo.check('a'), memo.check('b')]);
    await memo.check('a');
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('falha de leitura não fica memoizada', async () => {
    let calls = 0;
    const memo = memoizeSubscriptionGate({
      check: async () => {
        calls += 1;
        if (calls === 1) throw new Error('db down');
        return { active: true as const, status: 'active' };
      },
    });
    await expect(memo.check('a')).rejects.toThrow('db down');
    await expect(memo.check('a')).resolves.toEqual({ active: true, status: 'active' });
  });
});

describe('recordSubscriptionSkip', () => {
  it('conta na métrica por worker/status e loga o desfecho canônico', async () => {
    const metric = getWorkersMetricsRegistry().getSingleMetric(
      'hm_worker_subscription_inactive_skipped_total',
    );
    if (!metric) throw new Error('métrica não registrada');
    const value = async () =>
      (await metric.get()).values
        .filter((v) => v.labels['worker'] === 'flow-step' && v.labels['status'] === 'expired')
        .reduce((acc, v) => acc + v.value, 0);
    const before = await value();
    const info = vi.fn();
    recordSubscriptionSkip(
      { ...logger, info } as unknown as Parameters<typeof recordSubscriptionSkip>[0],
      'flow-step',
      'ws',
      'expired',
      { executionId: 'e' },
    );
    expect(await value()).toBe(before + 1);
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('flow-step'),
      expect.objectContaining({ outcome: 'skipped_subscription_inactive', workspaceId: 'ws' }),
    );
  });
});

// ─── 3a) Inbound não importa o portão (estrutural) ─────────────────────────────

describe('inbound não passa pelo portão de assinatura', () => {
  it('nenhum módulo de produção em src/inbound importa subscription-gate', () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../inbound');
    const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      expect(readFileSync(path.join(dir, file), 'utf8')).not.toMatch(/subscription-gate/);
    }
  });
});

// ─── 2) + 3b) Postgres dev ─────────────────────────────────────────────────────

describe.skipIf(!url)('portão real + inbound com empresa expired (Postgres dev)', () => {
  const sfx = randomUUID().slice(0, 8);
  const phoneNumberId = `PN_F71S06_${sfx}`;
  let workspaceId = '';

  const noopSocket: InboundSocketPort = {
    async emitMessageNew() {},
    async emitContactPresence() {},
    async emitConversationAssigned() {},
  };
  const noopStatusDeps: StatusDeps = {
    channels: {
      async resolve() {
        return null;
      },
    },
    persistence: {
      async applyStatus() {
        return { outcome: 'not_found' as const };
      },
    },
    socket: { async emitStatusChanged() {} },
    orphan: {
      async record() {},
      async drain() {
        return null;
      },
    },
  };

  beforeAll(async () => {
    const db = getDb();
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: 'F71S06 inbound', slug: `f71s06-in-${sfx}`, subscriptionStatus: 'expired' })
      .returning({ id: schema.workspaces.id });
    if (!ws) throw new Error('workspace');
    workspaceId = ws.id;
    await db.insert(schema.channels).values({
      workspaceId,
      provider: 'meta_whatsapp',
      name: 'WA F71S06',
      phoneNumberId,
      wabaId: `WABA_F71S06_${sfx}`,
      isActive: true,
    });
  });

  afterAll(async () => {
    if (workspaceId) {
      const db = getDb();
      const convs = await db
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(eq(schema.conversations.workspaceId, workspaceId));
      for (const c of convs) {
        await db.delete(schema.messages).where(eq(schema.messages.conversationId, c.id));
      }
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    }
    await closeDb();
  });

  it('o portão lê o status atual a cada job (sem cache): expired → active → canceled', async () => {
    const setStatus = (subscriptionStatus: string) =>
      getDb()
        .update(schema.workspaces)
        .set({ subscriptionStatus })
        .where(eq(schema.workspaces.id, workspaceId));

    expect(await subscriptionGate.check(workspaceId)).toEqual({ active: false, status: 'expired' });
    await setStatus('active');
    expect(await subscriptionGate.check(workspaceId)).toEqual({ active: true, status: 'active' });
    await setStatus('canceled');
    expect(await subscriptionGate.check(workspaceId)).toEqual({
      active: false,
      status: 'canceled',
    });
    await setStatus('expired');
    expect(await subscriptionGate.check(randomUUID())).toEqual({
      active: false,
      status: 'not_found',
    });
  });

  it('empresa expired continua recebendo: a mensagem que chega é gravada', async () => {
    const persistence = new DbInboundPersistence(noopSocket, noopStatusDeps, logger);
    const externalId = `wamid.f71s06.${sfx}`;
    const event: InboundEvent = {
      type: 'message',
      provider: 'meta_whatsapp',
      contactRemoteId: '5511' + sfx.replace(/\D/g, '0').slice(0, 7).padEnd(7, '0'),
      externalId,
      messageType: 'text',
      content: 'oi, ainda estão aí?',
      rawTimestamp: new Date().toISOString(),
    };

    const res = await persistence.persist({
      provider: 'meta_whatsapp',
      routing: { phoneNumberId },
      events: [event],
    });

    expect(res.resolved).toBe(true);
    expect(res.inserted).toBe(1);
    const [row] = await getDb()
      .select({
        workspaceId: schema.messages.workspaceId,
        direction: schema.messages.direction,
        content: schema.messages.content,
      })
      .from(schema.messages)
      .where(eq(schema.messages.externalId, externalId));
    expect(row).toEqual({ workspaceId, direction: 'inbound', content: 'oi, ainda estão aí?' });
  });
});
