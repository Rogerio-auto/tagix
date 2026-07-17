/**
 * Worker de retenção (F56-S25, DB-02) — barrel + scheduler.
 *
 * `startRetentionWorker({ redis, logger })`: tick periódico (singleton via lock
 * Redis) que purga em lotes as linhas de `webhook_events` mais antigas que o
 * horizonte de retenção. Bounded por tick (`batchSize * maxBatchesPerTick`);
 * backlog sobra para o próximo tick.
 *
 * O orchestrator registra isto no bootstrap dos workers (F56-S17, composition
 * root) — este slot NÃO edita `main.ts`/`bootstrap`. Config toda por env
 * (`resolveRetentionConfig`), com defaults seguros.
 */
import type { Logger } from '@hm/logger';
import {
  RETENTION_SWEEP_LOCK_KEY,
  RETENTION_SWEEP_LOCK_TTL_MS,
  acquireSweepLock,
  resolveRetentionConfig,
  type RedisLike,
  type RetentionConfig,
} from './config';
import { createDbSweepPort } from './db-port';
import { computeCutoff, runSweep, type RetentionSweepPort, type SweepResult } from './sweep';

export interface RetentionWorkerHandle {
  stop(): Promise<void>;
}

export interface RetentionWorkerDeps {
  readonly redis: RedisLike;
  readonly logger: Logger;
  /** Sobrescreve pontos da config resolvida por env (testes / tuning). */
  readonly config?: Partial<RetentionConfig>;
  /** Porta de sweep injetável (default: `createDbSweepPort()`). */
  readonly port?: RetentionSweepPort;
  /** Relógio injetável (default: `Date.now`). */
  readonly now?: () => Date;
}

/**
 * Roda UMA passada do sweep sob o lock singleton. Exportada para o bootstrap/
 * testes dispararem um tick determinístico. Retorna o resultado ou `null` se
 * outra instância detém o lock (nada varrido aqui).
 */
export async function runRetentionSweepOnce(deps: {
  readonly redis: RedisLike;
  readonly logger: Logger;
  readonly port: RetentionSweepPort;
  readonly config: RetentionConfig;
  readonly now: () => Date;
}): Promise<SweepResult | null> {
  const release = await acquireSweepLock(
    deps.redis,
    RETENTION_SWEEP_LOCK_KEY,
    RETENTION_SWEEP_LOCK_TTL_MS,
  );
  if (!release) return null; // outra instância está varrendo

  try {
    const cutoff = computeCutoff(deps.now(), deps.config.horizonMs);
    const result = await runSweep(deps.port, {
      cutoff,
      batchSize: deps.config.batchSize,
      maxBatches: deps.config.maxBatchesPerTick,
    });
    if (result.deleted > 0 || result.reachedCap) {
      deps.logger.info('retention sweep', {
        table: 'webhook_events',
        deleted: result.deleted,
        batches: result.batches,
        reachedCap: result.reachedCap,
        cutoff: cutoff.toISOString(),
      });
    }
    return result;
  } finally {
    await release();
  }
}

export function startRetentionWorker(deps: RetentionWorkerDeps): RetentionWorkerHandle {
  const config: RetentionConfig = { ...resolveRetentionConfig(), ...deps.config };
  const port = deps.port ?? createDbSweepPort();
  const now = deps.now ?? (() => new Date());
  let running = false;

  const tick = (): void => {
    if (running) return; // não sobrepõe ticks (sweep pode durar mais que o intervalo)
    running = true;
    void runRetentionSweepOnce({ redis: deps.redis, logger: deps.logger, port, config, now })
      .catch((err: unknown) => {
        deps.logger.error('retention sweep falhou', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };

  // Primeiro tick com atraso curto (não competir com o warm-up do processo),
  // depois na cadência configurada.
  const initial = setTimeout(tick, config.initialDelayMs);
  initial.unref?.();
  const timer = setInterval(tick, config.intervalMs);
  timer.unref?.();

  deps.logger.info('retention worker iniciado', {
    table: 'webhook_events',
    horizonMs: config.horizonMs,
    batchSize: config.batchSize,
    maxBatchesPerTick: config.maxBatchesPerTick,
    intervalMs: config.intervalMs,
  });

  return {
    async stop(): Promise<void> {
      clearTimeout(initial);
      clearInterval(timer);
      await Promise.resolve();
    },
  };
}

export {
  RETENTION_SWEEP_LOCK_KEY,
  RETENTION_SWEEP_LOCK_TTL_MS,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_SWEEP_BATCH_SIZE,
  DEFAULT_MAX_BATCHES_PER_TICK,
  DEFAULT_SWEEP_INTERVAL_MS,
  DEFAULT_INITIAL_DELAY_MS,
  resolveRetentionConfig,
  parsePositiveInt,
  acquireSweepLock,
  type RedisLike,
  type RetentionConfig,
  type ReleaseLock,
} from './config';
export { createDbSweepPort } from './db-port';
export {
  computeCutoff,
  runSweep,
  type RetentionSweepPort,
  type SweepOptions,
  type SweepResult,
} from './sweep';
