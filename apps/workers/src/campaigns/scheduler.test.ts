/**
 * F58-S11 — scheduler singleton com lock RENOVADO. Redis e timer falsos:
 * o heartbeat e disparado a mao (relogio deterministico).
 */
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@hm/logger';
import {
  CAMPAIGN_SCHEDULER_LOCK_KEY,
  CAMPAIGN_SCHEDULER_LOCK_TTL_MS,
  acquireSchedulerLease,
  campaignTickMsFromEnv,
  runScheduledCampaignTick,
  type HeartbeatTimer,
  type RedisLike,
} from './scheduler';
import type { CampaignTickPorts, RunningCampaign } from './tick';

function makeLogger(): Logger {
  const l = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { ...l, child: () => l } as unknown as Logger;
}

/** Redis em memoria: SET NX PX + GET/DEL/PEXPIRE condicionais por token (o que os Lua fazem). */
class FakeRedis implements RedisLike {
  readonly store = new Map<string, string>();
  readonly ttl = new Map<string, number>();
  failEval = false;

  async set(
    key: string,
    value: string,
    _mode: 'PX',
    ttlMs: number,
    _cond: 'NX',
  ): Promise<'OK' | null> {
    if (this.store.has(key)) return null;
    this.store.set(key, value);
    this.ttl.set(key, ttlMs);
    return 'OK';
  }

  async eval(script: string, _n: number, ...args: string[]): Promise<unknown> {
    if (this.failEval) throw new Error('redis down');
    const [key, token, ttl] = args;
    if (key === undefined || this.store.get(key) !== token) return 0;
    if (script.includes('pexpire')) {
      this.ttl.set(key, Number(ttl));
      return 1;
    }
    this.store.delete(key);
    return 1;
  }
}

/** Timer manual: `fire()` executa o heartbeat registrado. */
function manualTimer(): HeartbeatTimer & { fire(): void; active(): boolean } {
  let fn: (() => void) | null = null;
  return {
    setInterval: (f) => {
      fn = f;
      return 1;
    },
    clearInterval: () => {
      fn = null;
    },
    fire: () => fn?.(),
    active: () => fn !== null,
  };
}

const CAMP: RunningCampaign = {
  id: 'c1',
  workspaceId: 'w1',
  channelId: 'ch1',
  sendWindows: null,
  rateLimitPerMinute: 60,
  deliveryRate: null,
  endAt: null,
  nextTickAt: null,
};

function ports(over: Partial<CampaignTickPorts> = {}): CampaignTickPorts {
  return {
    promoteScheduledCampaigns: vi.fn(async () => []),
    listDueCampaigns: vi.fn(async () => []),
    checkSubscription: vi.fn(async () => ({ active: true as const, status: 'active' })),
    inspectChannel: vi.fn(async () => ({
      kind: 'ready' as const,
      health: { qualityRating: 'GREEN' as const, tierLimit: 1000 },
    })),
    reapRecipients: vi.fn(async () => ({ recovered: 0, finalized: 0 })),
    ensureDailyQuota: vi.fn(async (_c: RunningCampaign, now: Date) => ({
      remaining: null,
      resetsAt: now,
    })),
    pendingRecipients: vi.fn(async () => []),
    checkConsent: vi.fn(async () => ({
      allowed: true as const,
      usedFallbackTimezone: false,
      timezone: 'UTC',
    })),
    denyRecipient: vi.fn(async () => undefined),
    deferRecipient: vi.fn(async () => undefined),
    enqueueDelivery: vi.fn(async () => ({ kind: 'enqueued' as const })),
    settleCampaign: vi.fn(async () => false),
    closeCampaign: vi.fn(async () => ({ closed: true, notReached: 0 })),
    pauseCampaign: vi.fn(async () => undefined),
    scheduleNextTick: vi.fn(async () => undefined),
    applyErrorAction: vi.fn(async () => undefined),
    ...over,
  };
}

describe('acquireSchedulerLease', () => {
  it('singleton: a segunda instancia nao adquire enquanto a primeira detem', async () => {
    const redis = new FakeRedis();
    const a = await acquireSchedulerLease(redis, 'k', 1000);
    const b = await acquireSchedulerLease(redis, 'k', 1000);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    await a?.release();
    expect(await acquireSchedulerLease(redis, 'k', 1000)).not.toBeNull();
  });

  it('renew so estende o PROPRIO lock; lock tomado por outro => false', async () => {
    const redis = new FakeRedis();
    const a = await acquireSchedulerLease(redis, 'k', 1000);
    expect(await a?.renew()).toBe(true);
    redis.store.set('k', 'outra-instancia'); // expirou e outra instancia assumiu
    expect(await a?.renew()).toBe(false);
    await a?.release();
    expect(redis.store.get('k')).toBe('outra-instancia'); // release nao rouba
  });

  it('Redis fora => renew false (nao lanca)', async () => {
    const redis = new FakeRedis();
    const a = await acquireSchedulerLease(redis, 'k', 1000);
    redis.failEval = true;
    expect(await a?.renew()).toBe(false);
  });
});

describe('runScheduledCampaignTick', () => {
  it('outra instancia com o lock => nao toca no banco', async () => {
    const redis = new FakeRedis();
    redis.store.set(CAMPAIGN_SCHEDULER_LOCK_KEY, 'outra');
    const p = ports();
    const ran = await runScheduledCampaignTick({ ports: p, logger: makeLogger(), redis });
    expect(ran).toBe(false);
    expect(p.promoteScheduledCampaigns).not.toHaveBeenCalled();
    expect(p.listDueCampaigns).not.toHaveBeenCalled();
  });

  it('heartbeat renova o lock durante o tick e libera ao final', async () => {
    const redis = new FakeRedis();
    const timer = manualTimer();
    let ttlAfterBeat = 0;
    const p = ports({
      listDueCampaigns: vi.fn(async () => {
        redis.ttl.set(CAMPAIGN_SCHEDULER_LOCK_KEY, 1); // "quase expirando"
        timer.fire();
        await new Promise((r) => setImmediate(r));
        ttlAfterBeat = redis.ttl.get(CAMPAIGN_SCHEDULER_LOCK_KEY) ?? 0;
        return [];
      }),
    });
    await runScheduledCampaignTick({ ports: p, logger: makeLogger(), redis, timer });
    expect(ttlAfterBeat).toBe(CAMPAIGN_SCHEDULER_LOCK_TTL_MS);
    // Renovou para o TTL cheio no meio do tick; ao final, liberou e parou o heartbeat.
    expect(redis.store.has(CAMPAIGN_SCHEDULER_LOCK_KEY)).toBe(false);
    expect(timer.active()).toBe(false);
  });

  it('renovacao perdida aborta: a proxima campanha nao e processada', async () => {
    const redis = new FakeRedis();
    const timer = manualTimer();
    const pending = vi.fn(async () => [] as never[]);
    const p = ports({
      listDueCampaigns: vi.fn(async () => {
        // Outra instancia tomou o lock (expirou) e o heartbeat percebe.
        redis.store.set(CAMPAIGN_SCHEDULER_LOCK_KEY, 'outra');
        timer.fire();
        await new Promise((r) => setImmediate(r));
        return [CAMP, { ...CAMP, id: 'c2' }];
      }),
      pendingRecipients: pending,
    });
    await runScheduledCampaignTick({ ports: p, logger: makeLogger(), redis, timer });
    expect(p.checkSubscription).not.toHaveBeenCalled();
    expect(pending).not.toHaveBeenCalled();
    // E nao apagou o lock da outra instancia.
    expect(redis.store.get(CAMPAIGN_SCHEDULER_LOCK_KEY)).toBe('outra');
  });

  it('TTL do lock cobre 3 batimentos', () => {
    expect(CAMPAIGN_SCHEDULER_LOCK_TTL_MS).toBeGreaterThanOrEqual(3 * 5000);
  });
});

describe('campaignTickMsFromEnv', () => {
  it('default 5s; aceita override valido; ignora lixo', () => {
    expect(campaignTickMsFromEnv({})).toBe(5000);
    expect(campaignTickMsFromEnv({ CAMPAIGN_TICK_MS: '2000' })).toBe(2000);
    expect(campaignTickMsFromEnv({ CAMPAIGN_TICK_MS: 'abc' })).toBe(5000);
    expect(campaignTickMsFromEnv({ CAMPAIGN_TICK_MS: '-1' })).toBe(5000);
  });
});
