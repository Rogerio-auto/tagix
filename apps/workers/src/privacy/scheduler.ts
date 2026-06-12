/**
 * Lock + tipos do processador de export LGPD (F10-S02). Singleton entre instâncias
 * via lock Redis (mesmo padrão do dispatcher de webhooks / dashboard): só uma
 * instância processa por tick, evitando dois workers montando o mesmo artefato.
 */
export const PRIVACY_EXPORT_LOCK_KEY = 'hm:lock:scheduler:privacy-export' as const;
export const PRIVACY_EXPORT_LOCK_TTL_MS = 120_000;
/** Cadência do drain: 15s — export é assíncrono, não precisa ser instantâneo. */
export const DEFAULT_EXPORT_TICK_MS = 15_000;

export interface RedisLike {
  set(key: string, value: string, mode: 'PX', ttlMs: number, cond: 'NX'): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

const UNLOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export type ReleaseLock = () => Promise<void>;

/** Adquire o lock singleton; retorna o release ou `null` se outro o detém. */
export async function acquireSchedulerLock(
  redis: RedisLike,
  key: string,
  ttlMs: number,
): Promise<ReleaseLock | null> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (ok !== 'OK') return null;
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await redis.eval(UNLOCK_LUA, 1, key, token);
  };
}
