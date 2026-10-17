/**
 * F73-S10 — limite de taxa do Copiloto por membro, contra o Redis de dev (R5).
 */
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import type { Logger } from '@hm/logger';
import { COPILOT_RATE_LIMITS, createRedisCopilotRateLimiter } from './rate-limit';

const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});
const prefix = `test:copilot:rl:${randomUUID()}`;

afterAll(async () => {
  const keys = await redis.keys(`${prefix}:*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
});

describe('createRedisCopilotRateLimiter', () => {
  it('6 por minuto: o 7º é recusado e volta a passar quando a janela desliza', async () => {
    const limiter = createRedisCopilotRateLimiter({ redis, keyPrefix: prefix });
    const member = randomUUID();
    const t0 = new Date('2026-10-17T12:00:00.000Z');
    for (let i = 0; i < COPILOT_RATE_LIMITS.perMinute; i++) {
      expect(await limiter.consume(member, new Date(t0.getTime() + i * 1000))).toEqual({
        allowed: true,
      });
    }
    const seventh = await limiter.consume(member, new Date(t0.getTime() + 10_000));
    expect(seventh).toMatchObject({ allowed: false, window: 'minute' });
    if (!seventh.allowed) expect(seventh.retryAfterSec).toBe(50);
    // Recusa não consome cota: 61 s depois do 1º, abre exatamente uma vaga.
    expect(await limiter.consume(member, new Date(t0.getTime() + 60_500))).toEqual({
      allowed: true,
    });
    expect((await limiter.consume(member, new Date(t0.getTime() + 60_600))).allowed).toBe(false);
  });

  it('a cota é por membro', async () => {
    const limiter = createRedisCopilotRateLimiter({
      redis,
      keyPrefix: prefix,
      limits: { perMinute: 1, perDay: 10 },
    });
    const now = new Date();
    expect((await limiter.consume(randomUUID(), now)).allowed).toBe(true);
    expect((await limiter.consume(randomUUID(), now)).allowed).toBe(true);
  });

  it('teto diário', async () => {
    const limiter = createRedisCopilotRateLimiter({
      redis,
      keyPrefix: prefix,
      limits: { perMinute: 100, perDay: 3 },
    });
    const member = randomUUID();
    const now = new Date();
    for (let i = 0; i < 3; i++) expect((await limiter.consume(member, now)).allowed).toBe(true);
    expect(await limiter.consume(member, now)).toMatchObject({ allowed: false, window: 'day' });
  });

  it('Redis fora: deixa passar e registra a degradação', async () => {
    const dead = new Redis('redis://127.0.0.1:1', {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    dead.on('error', () => undefined);
    const warnings: string[] = [];
    const noop = (): void => undefined;
    const logger: Logger = {
      debug: noop,
      info: noop,
      warn: (msg) => void warnings.push(msg),
      error: noop,
      child: () => logger,
    };
    const limiter = createRedisCopilotRateLimiter({ redis: dead, logger });
    expect(await limiter.consume(randomUUID())).toEqual({ allowed: true });
    expect(warnings).toContain('copilot.rate_limit_degraded');
    dead.disconnect();
  });
});
