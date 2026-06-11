/**
 * Locks + tipos compartilhados dos refresh jobs do dashboard (F8-S02 / DASHBOARD.md
 * §5). Dois jobs cron:
 *   - snapshot (5min): popula `dashboard_snapshots` com as métricas de cadência 5min.
 *   - mv-refresh (1h/1d): `REFRESH MATERIALIZED VIEW CONCURRENTLY` das mv_dashboard_*.
 *
 * Singleton entre instâncias via lock Redis (mesmo padrão de flows/calendar). Cada
 * job tem sua própria chave de lock para não bloquear o outro.
 */
export const DASHBOARD_SNAPSHOT_LOCK_KEY = 'hm:lock:scheduler:dashboard-snapshot' as const;
export const DASHBOARD_MV_LOCK_KEY = 'hm:lock:scheduler:dashboard-mv' as const;
export const DASHBOARD_LOCK_TTL_MS = 4 * 60_000;

export const DEFAULT_SNAPSHOT_TICK_MS = 5 * 60_000; // 5min (§5)
export const DEFAULT_MV_TICK_MS = 60 * 60_000; // 1h (§5)

export interface RedisLike {
  set(key: string, value: string, mode: 'PX', ttlMs: number, cond: 'NX'): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

const UNLOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export type ReleaseLock = () => Promise<void>;

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
