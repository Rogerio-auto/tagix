/**
 * Cliente Redis do `@hm/workers` (F52-S10). Reusa o mesmo broker já presente na
 * stack (Socket.io adapter, rate-limit, locks de scheduler) via `REDIS_URL`.
 *
 * `lazyConnect` evita abrir socket em ambientes sem Redis (testes que não tocam
 * o lock distribuído nunca conectam). `maxRetriesPerRequest: 1` falha rápido um
 * comando de lock travado — o erro propaga e vira nack → DLX, em vez de pendurar.
 */
import Redis from 'ioredis';

export const DEFAULT_REDIS_URL = 'redis://localhost:6379';

/** Lê a URL do Redis do ambiente (default: localhost dev). */
export function redisUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env['REDIS_URL'];
  return raw === undefined || raw.length === 0 ? DEFAULT_REDIS_URL : raw;
}

/** Cria um cliente `ioredis` configurado para uso em locks (lazy + fail-fast). */
export function createRedisClient(url: string = redisUrlFromEnv()): Redis {
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
}
