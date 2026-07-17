/**
 * Testes do watchdog de renovação de lock (F56-S17, INF-10). A primitiva vive em
 * `flows/scheduler.ts` (`acquireSchedulerLock`), consumida pelo composition root
 * deste diretório — por isso o teste mora aqui (dentro da fronteira do slot).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireSchedulerLock, type RedisLike } from '../flows/scheduler';

function fakeRedis(setResult: 'OK' | null = 'OK'): RedisLike {
  return {
    set: vi.fn(async (): Promise<'OK' | null> => setResult),
    eval: vi.fn(async () => 1),
  };
}

const renewCalls = (redis: RedisLike): unknown[][] =>
  vi.mocked(redis.eval).mock.calls.filter((c) => String(c[0]).includes('pexpire'));

afterEach(() => {
  vi.useRealTimers();
});

describe('acquireSchedulerLock — watchdog de renovação de TTL', () => {
  it('renova o TTL periodicamente enquanto detém o lock', async () => {
    vi.useFakeTimers();
    const redis = fakeRedis('OK');
    const release = await acquireSchedulerLock(redis, 'k', 900, { renewIntervalMs: 300 });
    expect(release).toBeTypeOf('function');
    await vi.advanceTimersByTimeAsync(650); // ~2 renovações
    expect(renewCalls(redis).length).toBeGreaterThanOrEqual(2);
    await release?.();
  });

  it('para de renovar após o release (sem vazamento de timer)', async () => {
    vi.useFakeTimers();
    const redis = fakeRedis('OK');
    const release = await acquireSchedulerLock(redis, 'k', 900, { renewIntervalMs: 300 });
    await release?.();
    vi.mocked(redis.eval).mockClear();
    await vi.advanceTimersByTimeAsync(1200);
    expect(renewCalls(redis).length).toBe(0);
  });

  it('dispara onRenewFailure quando o lock é perdido (renew retorna 0)', async () => {
    vi.useFakeTimers();
    const redis: RedisLike = {
      set: vi.fn(async (): Promise<'OK' | null> => 'OK'),
      eval: vi.fn(async () => 0),
    };
    const onRenewFailure = vi.fn();
    const release = await acquireSchedulerLock(redis, 'k', 900, {
      renewIntervalMs: 300,
      onRenewFailure,
    });
    await vi.advanceTimersByTimeAsync(350);
    expect(onRenewFailure).toHaveBeenCalledWith({ key: 'k' });
    await release?.();
  });

  it('não inicia watchdog quando não adquire o lock', async () => {
    vi.useFakeTimers();
    const redis = fakeRedis(null);
    const release = await acquireSchedulerLock(redis, 'k', 900, { renewIntervalMs: 300 });
    expect(release).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(renewCalls(redis).length).toBe(0);
  });
});
