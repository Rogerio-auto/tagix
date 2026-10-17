/**
 * Lock singleton e constantes do worker do piloto automático (F73-S13).
 *
 * Mesmo padrão dos demais schedulers (`hm:lock:scheduler:*`, `SET NX PX` + token + unlock por
 * Lua): com várias instâncias do worker, só uma gera as sugestões da hora.
 */
export const COPILOT_AUTOPILOT_LOCK_KEY = 'hm:lock:scheduler:copilot-autopilot' as const;
/** Posse máxima do lock por tick; o tick para de pegar workspace novo antes disso. */
export const COPILOT_AUTOPILOT_LOCK_TTL_MS = 20 * 60_000;
/** De hora em hora (COPILOTO.md §7.2). */
export const COPILOT_AUTOPILOT_INTERVAL_MS = 60 * 60_000;
/** Atraso do primeiro tick depois do boot (não competir com o warm-up do processo). */
export const COPILOT_AUTOPILOT_INITIAL_DELAY_MS = 90_000;
/** Workspaces lidos por página (keyset por id) e processados em sequência. */
export const COPILOT_AUTOPILOT_WORKSPACE_BATCH = 25;

export interface RedisLike {
  set(key: string, value: string, mode: 'PX', ttlMs: number, cond: 'NX'): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

const UNLOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export type ReleaseLock = () => Promise<void>;

/** Adquire o lock ou devolve `null` (outra instância está processando). */
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
