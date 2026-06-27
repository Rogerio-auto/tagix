/**
 * Testes do lock distribuído Redis (F52-S10).
 *
 * Usa um `FakeRedis` fiel (NX/PX + Lua compare-and-delete/renew) — determinístico
 * e independente de infra. Há também um bloco de integração que roda contra o
 * Redis dev SOMENTE quando `REDIS_URL` está presente no ambiente.
 */
import { describe, it, expect, vi } from 'vitest';
import { CompositeLockStore, InMemoryFifoLockStore } from '../lock';
import {
  RedisLockStore,
  UNLOCK_LUA,
  RENEW_LUA,
  type RedisLockClient,
} from './lock-store';

/** Modelo fiel de `set NX PX` + `eval` (apenas os dois scripts do lock). */
class FakeRedis implements RedisLockClient {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();

  private live(key: string): { value: string; expiresAt: number } | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return e;
  }

  async set(
    key: string,
    value: string,
    _mode: 'PX',
    ttlMs: number,
    _cond: 'NX',
  ): Promise<'OK' | null> {
    if (this.live(key)) return null; // NX falha se já existe e está vivo
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return 'OK';
  }

  async eval(
    script: string,
    _numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    const key = String(args[0]);
    const token = String(args[1]);
    const e = this.live(key);
    if (script === UNLOCK_LUA) {
      if (e && e.value === token) {
        this.store.delete(key);
        return 1;
      }
      return 0;
    }
    if (script === RENEW_LUA) {
      if (e && e.value === token) {
        e.expiresAt = Date.now() + Number(args[2]);
        return 1;
      }
      return 0;
    }
    throw new Error(`script não modelado: ${script}`);
  }

  /** Helper de teste: o valor bruto (token) guardado numa chave. */
  rawToken(key: string): string | undefined {
    return this.live(key)?.value;
  }
}

const fastSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, Math.min(ms, 5)));

describe('RedisLockStore — exclusão mútua entre processos', () => {
  it('duas "instâncias" no mesmo Redis não entram juntas', async () => {
    const redis = new FakeRedis();
    const a = new RedisLockStore(redis, { autoRenew: false, sleep: fastSleep });
    const b = new RedisLockStore(redis, { autoRenew: false, sleep: fastSleep });

    const releaseA = await a.acquire('k', 5_000);

    let bAcquired = false;
    const bPromise = b.acquire('k', 5_000).then((rel) => {
      bAcquired = true;
      return rel;
    });

    // Enquanto A detém, B não pode adquirir.
    await new Promise((r) => setTimeout(r, 30));
    expect(bAcquired).toBe(false);

    await releaseA();
    const releaseB = await bPromise;
    expect(bAcquired).toBe(true);
    await releaseB();
  });

  it('release só remove o lock do próprio dono (token)', async () => {
    const redis = new FakeRedis();
    const a = new RedisLockStore(redis, { autoRenew: false, sleep: fastSleep });

    const releaseA = await a.acquire('k', 60); // TTL curto
    expect(redis.rawToken('k')).toBeDefined();

    // A expira (TTL), B adquire com NOVO token; depois A tenta liberar.
    await new Promise((r) => setTimeout(r, 80)); // TTL de A expira
    const b = new RedisLockStore(redis, { autoRenew: false, sleep: fastSleep });
    const releaseB = await b.acquire('k', 5_000);
    const tokenB = redis.rawToken('k');

    // release de A NÃO pode derrubar o lock de B (token diferente).
    await releaseA();
    expect(redis.rawToken('k')).toBe(tokenB);

    await releaseB();
    expect(redis.rawToken('k')).toBeUndefined();
  });

  it('crash do dono não trava a conversa — TTL libera', async () => {
    const redis = new FakeRedis();
    const crashed = new RedisLockStore(redis, { autoRenew: false, sleep: fastSleep });
    // Adquire e "crasha": nunca libera, e sem watchdog (renew off).
    await crashed.acquire('k', 50);

    const next = new RedisLockStore(redis, {
      autoRenew: false,
      sleep: fastSleep,
      retryDelayMs: 5,
    });
    // Deve conseguir após o TTL expirar (~50ms).
    const release = await next.acquire('k', 5_000);
    expect(redis.rawToken('k')).toBeDefined();
    await release();
  });

  it('watchdog renova o TTL enquanto a seção crítica roda', async () => {
    vi.useFakeTimers();
    try {
      const redis = new FakeRedis();
      const renewSpy = vi.spyOn(redis, 'eval');
      const store = new RedisLockStore(redis, { sleep: fastSleep });

      const release = await store.acquire('k', 300); // renova a cada ~100ms
      // Avança além de 1 TTL com renovações periódicas.
      await vi.advanceTimersByTimeAsync(700);
      // Lock continua vivo graças às renovações.
      expect(redis.rawToken('k')).toBeDefined();
      const renews = renewSpy.mock.calls.filter((c) => c[0] === RENEW_LUA);
      expect(renews.length).toBeGreaterThanOrEqual(2);
      await release();
    } finally {
      vi.useRealTimers();
    }
  });

  it('acquire estoura timeout quando o lock nunca libera', async () => {
    const redis = new FakeRedis();
    const holder = new RedisLockStore(redis, { autoRenew: false, sleep: fastSleep });
    await holder.acquire('k', 60_000); // segura por muito tempo

    const waiter = new RedisLockStore(redis, {
      sleep: fastSleep,
      retryDelayMs: 5,
      acquireTimeoutMs: 40,
    });
    await expect(waiter.acquire('k', 60_000)).rejects.toThrow(/timeout/i);
  });
});

describe('CompositeLockStore — FIFO local + exclusão Redis', () => {
  it('preserva ordem de chegada da mesma conversa numa instância', async () => {
    const redis = new FakeRedis();
    const store = new CompositeLockStore(
      new InMemoryFifoLockStore(),
      new RedisLockStore(redis, { autoRenew: false, sleep: fastSleep }),
    );

    const order: number[] = [];
    const run = (n: number, delay: number): Promise<void> =>
      store.acquire('k', 5_000).then(async (release) => {
        await new Promise((r) => setTimeout(r, delay));
        order.push(n);
        await release();
      });

    await Promise.all([run(1, 30), run(2, 1), run(3, 1)]);
    expect(order).toEqual([1, 2, 3]);
    expect(redis.rawToken('k')).toBeUndefined();
  });

  it('chaves distintas correm em paralelo', async () => {
    const redis = new FakeRedis();
    const store = new CompositeLockStore(
      new InMemoryFifoLockStore(),
      new RedisLockStore(redis, { autoRenew: false, sleep: fastSleep }),
    );
    let concurrent = 0;
    let max = 0;
    const run = (key: string): Promise<void> =>
      store.acquire(key, 5_000).then(async (release) => {
        concurrent += 1;
        max = Math.max(max, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent -= 1;
        await release();
      });
    await Promise.all([run('a'), run('b')]);
    expect(max).toBe(2);
  });
});

// Integração contra Redis real — só quando REDIS_URL existe (dev/CI com Redis).
const REDIS_URL = process.env['REDIS_URL'];
describe.skipIf(!REDIS_URL)('RedisLockStore — integração (Redis real)', () => {
  it('exclusão mútua entre dois clientes contra Redis dev', async () => {
    const { default: Redis } = await import('ioredis');
    const c1 = new Redis(REDIS_URL as string, { maxRetriesPerRequest: 1 });
    const c2 = new Redis(REDIS_URL as string, { maxRetriesPerRequest: 1 });
    const key = `hm:test:lock:${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const a = new RedisLockStore(c1, { autoRenew: false });
      const b = new RedisLockStore(c2, { autoRenew: false, retryDelayMs: 10 });

      const releaseA = await a.acquire(key, 5_000);
      let bGot = false;
      const bp = b.acquire(key, 5_000).then((rel) => {
        bGot = true;
        return rel;
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(bGot).toBe(false);
      await releaseA();
      const releaseB = await bp;
      expect(bGot).toBe(true);
      await releaseB();
    } finally {
      c1.disconnect();
      c2.disconnect();
    }
  });
});
