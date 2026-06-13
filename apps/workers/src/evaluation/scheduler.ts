/**
 * Lock + tipos compartilhados do worker de avaliacao (F29-S03 / AGENT_QUALITY_OBJECTIONS.md SS4).
 *
 * Cron tick (default 5min) que encontra conversas encerradas SEM avaliacao, chama o
 * LLM-judge (F29-S02) e persiste conversation_evaluations + objections (F29-S01).
 * Singleton entre instancias via lock Redis (mesmo padrao de dashboard-refresh).
 */
export const EVALUATION_LOCK_KEY = 'hm:lock:scheduler:evaluation' as const;
export const EVALUATION_LOCK_TTL_MS = 4 * 60_000;

/** Cadencia do tick (pos-conversa, nao em tempo real — SS7). */
export const DEFAULT_EVALUATION_TICK_MS = 5 * 60_000;

/** Tamanho do lote por tick (custo controlado — SS6). */
export const DEFAULT_EVALUATION_BATCH = 20;

/** Janela: so conversas encerradas nas ultimas N horas entram na busca. */
export const DEFAULT_EVALUATION_LOOKBACK_HOURS = 72;

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
