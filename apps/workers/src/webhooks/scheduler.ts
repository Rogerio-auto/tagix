/**
 * Lock + tipos do scheduler do dispatcher de webhooks (F9-S05). Singleton entre
 * instâncias via lock Redis (mesmo padrão de dashboard/flows/calendar): só uma
 * instância despacha por tick, evitando POSTs duplicados ao cliente.
 */
export const WEBHOOK_DISPATCH_LOCK_KEY = 'hm:lock:scheduler:webhook-dispatch' as const;
export const WEBHOOK_DISPATCH_LOCK_TTL_MS = 60_000;
/** Cadência do drain: 10s — entrega ágil sem martelar o banco. */
export const DEFAULT_DISPATCH_TICK_MS = 10_000;

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
