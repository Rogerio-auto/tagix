/**
 * Configuração + lock singleton do worker de retenção (F56-S25, DB-02).
 *
 * A tabela `webhook_events` é platform-level (fora do RLS de tenant) e é a mais
 * quente de escrita — cresce sem limite se nada a purgar. Este worker efetiva a
 * retenção prometida no schema: apaga em lotes as linhas mais antigas que o
 * horizonte. Tudo aqui é configurável por env, com defaults seguros.
 *
 * O sweep é singleton entre instâncias via lock Redis (mesmo padrão do
 * dispatcher de webhooks / export LGPD / dashboard-refresh): só uma instância
 * varre por tick, evitando dois workers competindo pelo DELETE na tabela quente.
 */

/** Chave do lock singleton do sweep de retenção. */
export const RETENTION_SWEEP_LOCK_KEY = 'hm:lock:scheduler:retention-sweep' as const;
/** Posse máxima do lock por tick (o sweep é bounded por `maxBatchesPerTick`). */
export const RETENTION_SWEEP_LOCK_TTL_MS = 120_000;

/** Horizonte de retenção default: 30 dias (LIVECHAT.md — hotfix de parser). */
export const DEFAULT_RETENTION_DAYS = 30;
/** Linhas por lote (LIMIT do DELETE). Evita travar a tabela quente num só DELETE. */
export const DEFAULT_SWEEP_BATCH_SIZE = 1_000;
/**
 * Teto de lotes por tick. Trabalho por tick é bounded (`batchSize * maxBatches`);
 * se ainda houver backlog, o próximo tick continua de onde parou.
 */
export const DEFAULT_MAX_BATCHES_PER_TICK = 50;
/** Cadência do sweep: diária. Retenção não precisa ser instantânea. */
export const DEFAULT_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1_000;
/** Atraso do primeiro tick após o boot — não competir com o warm-up do processo. */
export const DEFAULT_INITIAL_DELAY_MS = 60_000;

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

/**
 * Interpreta um inteiro positivo de env (por colchetes). Vazio/ausente/ inválido
 * (<= 0, NaN) → `fallback`. Nunca lança: config malformada degrada para o default.
 */
export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Config efetiva do worker, resolvida a partir do ambiente. */
export interface RetentionConfig {
  readonly horizonMs: number;
  readonly batchSize: number;
  readonly maxBatchesPerTick: number;
  readonly intervalMs: number;
  readonly initialDelayMs: number;
}

/** Resolve a config a partir do `process.env` (defaults seguros). */
export function resolveRetentionConfig(env: NodeJS.ProcessEnv = process.env): RetentionConfig {
  const days = parsePositiveInt(env['WEBHOOK_EVENTS_RETENTION_DAYS'], DEFAULT_RETENTION_DAYS);
  return {
    horizonMs: days * MS_PER_DAY,
    batchSize: parsePositiveInt(env['RETENTION_SWEEP_BATCH_SIZE'], DEFAULT_SWEEP_BATCH_SIZE),
    maxBatchesPerTick: parsePositiveInt(
      env['RETENTION_SWEEP_MAX_BATCHES'],
      DEFAULT_MAX_BATCHES_PER_TICK,
    ),
    intervalMs: parsePositiveInt(env['RETENTION_SWEEP_INTERVAL_MS'], DEFAULT_SWEEP_INTERVAL_MS),
    initialDelayMs: parsePositiveInt(
      env['RETENTION_SWEEP_INITIAL_DELAY_MS'],
      DEFAULT_INITIAL_DELAY_MS,
    ),
  };
}

/** Subset de Redis usado pelo lock singleton (SET NX PX + unlock por Lua). */
export interface RedisLike {
  set(key: string, value: string, mode: 'PX', ttlMs: number, cond: 'NX'): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

const UNLOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export type ReleaseLock = () => Promise<void>;

/**
 * Adquire o lock singleton do sweep. Retorna o release (idempotente) ou `null` se
 * outra instância já o detém — nesse caso este tick simplesmente não varre.
 */
export async function acquireSweepLock(
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
