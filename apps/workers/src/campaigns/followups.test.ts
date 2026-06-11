import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@hm/logger';
import {
  runFollowupDrainTick,
  acquireSchedulerLock,
  followupDrainMsFromEnv,
  DEFAULT_FOLLOWUP_DRAIN_MS,
  type FollowupPorts,
  type RedisLike,
} from './followups';

function makeLogger(): Logger {
  const l = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { ...l, child: () => l } as unknown as Logger;
}

function makeRedis(winLock = true): RedisLike {
  return {
    set: vi.fn(async () => (winLock ? 'OK' : null)),
    eval: vi.fn(async () => 1),
  };
}

function makePorts(over: Partial<FollowupPorts> = {}): FollowupPorts {
  return {
    scheduleFollowup: vi.fn(async () => ({ kind: 'scheduled' as const, scheduledFollowupId: 'sf1' })),
    drainDue: vi.fn(async () => ({ sent: 0, failed: 0 })),
    ...over,
  };
}

describe('acquireSchedulerLock (singleton)', () => {
  it('vence o lock e libera via eval (check-and-del)', async () => {
    const redis = makeRedis(true);
    const release = await acquireSchedulerLock(redis, 'k', 1000);
    expect(release).not.toBeNull();
    await release?.();
    expect(redis.eval).toHaveBeenCalledOnce();
  });
  it('perde o lock -> null', async () => {
    expect(await acquireSchedulerLock(makeRedis(false), 'k', 1000)).toBeNull();
  });
});

describe('runFollowupDrainTick', () => {
  it('com lock -> drena e retorna ran=true', async () => {
    const ports = makePorts({ drainDue: vi.fn(async () => ({ sent: 3, failed: 1 })) });
    const res = await runFollowupDrainTick({ ports, redis: makeRedis(true), logger: makeLogger() });
    expect(res.ran).toBe(true);
    expect(res.sent).toBe(3);
    expect(res.failed).toBe(1);
    expect(ports.drainDue).toHaveBeenCalledOnce();
  });
  it('sem lock (outra instancia) -> ran=false, nao drana', async () => {
    const ports = makePorts();
    const res = await runFollowupDrainTick({ ports, redis: makeRedis(false), logger: makeLogger() });
    expect(res.ran).toBe(false);
    expect(ports.drainDue).not.toHaveBeenCalled();
  });
  it('libera o lock mesmo se drainDue lanca', async () => {
    const redis = makeRedis(true);
    const ports = makePorts({
      drainDue: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    await expect(
      runFollowupDrainTick({ ports, redis, logger: makeLogger() }),
    ).rejects.toThrow('boom');
    expect(redis.eval).toHaveBeenCalledOnce();
  });
});

describe('followupDrainMsFromEnv', () => {
  it('default quando ausente/invalido', () => {
    expect(followupDrainMsFromEnv({})).toBe(DEFAULT_FOLLOWUP_DRAIN_MS);
    expect(followupDrainMsFromEnv({ CAMPAIGN_FOLLOWUP_DRAIN_MS: 'abc' })).toBe(
      DEFAULT_FOLLOWUP_DRAIN_MS,
    );
  });
  it('le valor valido do ambiente', () => {
    expect(followupDrainMsFromEnv({ CAMPAIGN_FOLLOWUP_DRAIN_MS: '5000' })).toBe(5000);
  });
});
