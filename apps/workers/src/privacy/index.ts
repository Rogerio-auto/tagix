/**
 * Worker de export LGPD (F10-S02) — barrel + scheduler.
 *
 * `startPrivacyExportProcessor({ redis, logger, storage? })`: cron tick (singleton
 * via lock Redis) que drena `data_export_jobs` pendentes, reúne a PII do scope sob
 * RLS, grava o artefato JSON via `@hm/storage` e marca o job `done`/`failed`.
 *
 * O orchestrator registra isto no bootstrap dos workers (composition root). Default
 * de storage vem de `createStorage()` (driver por env: local em dev, R2 em prod).
 */
import { createStorage, type IStorageDriver } from '@hm/storage';
import type { Logger } from '@hm/logger';
import { processPendingExports, type ProcessTickResult } from './processor';
import {
  acquireSchedulerLock,
  DEFAULT_EXPORT_TICK_MS,
  PRIVACY_EXPORT_LOCK_KEY,
  PRIVACY_EXPORT_LOCK_TTL_MS,
  type RedisLike,
} from './scheduler';

export interface PrivacyExportProcessorHandle {
  stop(): Promise<void>;
}

export function startPrivacyExportProcessor(deps: {
  redis: RedisLike;
  logger: Logger;
  intervalMs?: number;
  /** Injetável p/ teste; default = driver por env (`createStorage`). */
  storage?: IStorageDriver;
}): PrivacyExportProcessorHandle {
  const intervalMs = deps.intervalMs ?? DEFAULT_EXPORT_TICK_MS;
  const storage = deps.storage ?? createStorage();
  let running = false;

  const tick = (): void => {
    if (running) return;
    running = true;
    void (async () => {
      const release = await acquireSchedulerLock(
        deps.redis,
        PRIVACY_EXPORT_LOCK_KEY,
        PRIVACY_EXPORT_LOCK_TTL_MS,
      );
      if (!release) return; // outra instância está processando
      try {
        const result: ProcessTickResult = await processPendingExports({
          storage,
          logger: deps.logger,
        });
        if (result.processed > 0) {
          deps.logger.info('privacy export tick', { ...result });
        }
      } finally {
        await release();
      }
    })()
      .catch((err: unknown) => {
        deps.logger.error('privacy export tick falhou', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  deps.logger.info('privacy export processor iniciado', { intervalMs });

  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      await Promise.resolve();
    },
  };
}

export {
  collectExport,
  type ExportArtifact,
} from './collect';
export {
  artifactKey,
  processPendingExports,
  ARTIFACT_TTL_SECONDS,
  type ProcessDeps,
  type ProcessTickResult,
} from './processor';
export {
  PRIVACY_EXPORT_LOCK_KEY,
  PRIVACY_EXPORT_LOCK_TTL_MS,
  DEFAULT_EXPORT_TICK_MS,
  type RedisLike,
} from './scheduler';
