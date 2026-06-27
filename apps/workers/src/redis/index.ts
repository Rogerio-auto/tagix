/**
 * Redis do `@hm/workers` — barrel + fábrica do `LockStore` outbound (F52-S10).
 *
 * `resolveOutboundLockStore` decide o backend de lock por ambiente:
 * - `OUTBOUND_LOCK_DRIVER=redis` (ou `NODE_ENV=production` sem override) →
 *   `CompositeLockStore(InMemoryFifoLockStore, RedisLockStore)`: FIFO local
 *   estrito por conversa + exclusão mútua entre processos (multi-instância).
 * - `OUTBOUND_LOCK_DRIVER=memory` (ou qualquer ambiente não-produtivo) →
 *   `InMemoryFifoLockStore` puro (dev/teste, instância única).
 */
import type { Logger } from '@hm/logger';
import { CompositeLockStore, InMemoryFifoLockStore, type LockStore } from '../lock';
import { createRedisClient } from './client';
import { RedisLockStore } from './lock-store';

export { createRedisClient, redisUrlFromEnv, DEFAULT_REDIS_URL } from './client';
export {
  RedisLockStore,
  UNLOCK_LUA,
  RENEW_LUA,
  type RedisLockClient,
  type RedisLockStoreOptions,
  type LockLogger,
} from './lock-store';

export type OutboundLockDriver = 'redis' | 'memory';

/** Resolve o driver de lock do outbound a partir do ambiente. */
export function outboundLockDriverFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OutboundLockDriver {
  const raw = env['OUTBOUND_LOCK_DRIVER'];
  if (raw === 'redis' || raw === 'memory') return raw;
  // Default seguro: Redis só em produção; dev/teste ficam in-memory.
  return env['NODE_ENV'] === 'production' ? 'redis' : 'memory';
}

/** `LockStore` resolvido + handle de encerramento do recurso subjacente. */
export interface ResolvedLockStore {
  readonly store: LockStore;
  /** Encerra o cliente Redis (no-op no driver in-memory). */
  close(): Promise<void>;
}

/**
 * Constrói o `LockStore` do worker outbound conforme o ambiente. O cliente
 * Redis é criado (lazyConnect) apenas no driver `redis`.
 */
export function resolveOutboundLockStore(
  logger: Logger,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLockStore {
  const driver = outboundLockDriverFromEnv(env);

  if (driver === 'memory') {
    logger.info('outbound lock: driver in-memory (instância única)');
    return { store: new InMemoryFifoLockStore(), close: async () => undefined };
  }

  const redis = createRedisClient();
  const store = new CompositeLockStore(
    new InMemoryFifoLockStore(),
    new RedisLockStore(redis, { logger }),
  );
  logger.info('outbound lock: driver Redis (multi-instância) + FIFO local');

  return {
    store,
    async close(): Promise<void> {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    },
  };
}
