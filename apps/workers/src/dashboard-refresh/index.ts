/**
 * Refresh do dashboard (F8-S02) — barrel + schedulers. Composition surface para o
 * bootstrap: dois cron ticks idempotentes e singleton por lock Redis.
 *   - startDashboardSnapshotScheduler: 5min → popula dashboard_snapshots.
 *   - startDashboardMvScheduler: 1h → REFRESH CONCURRENTLY das mv_dashboard_*.
 */
import type { Logger } from '@hm/logger';
import {
  DEFAULT_MV_TICK_MS,
  DEFAULT_SNAPSHOT_TICK_MS,
  type RedisLike,
} from './scheduler';
import { runSnapshotTick, type SnapshotDeps } from './snapshot-job';
import { runMvRefreshTick, type MvRefreshDeps } from './mv-refresh-job';

export interface SchedulerHandle {
  stop(): Promise<void>;
}

function startInterval(
  intervalMs: number,
  label: string,
  logger: Logger,
  run: () => Promise<unknown>,
): SchedulerHandle {
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void run()
      .catch((err: unknown) => {
        logger.error(`${label}: tick falhou`, {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  logger.info(`${label} iniciado`, { intervalMs });
  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      await Promise.resolve();
    },
  };
}

export function startDashboardSnapshotScheduler(
  deps: { redis: RedisLike; logger: Logger; intervalMs?: number },
): SchedulerHandle {
  const snapshotDeps: SnapshotDeps = { redis: deps.redis, logger: deps.logger };
  return startInterval(
    deps.intervalMs ?? DEFAULT_SNAPSHOT_TICK_MS,
    'dashboard snapshot scheduler',
    deps.logger,
    () => runSnapshotTick(snapshotDeps),
  );
}

export function startDashboardMvScheduler(
  deps: { redis: RedisLike; logger: Logger; intervalMs?: number },
): SchedulerHandle {
  const mvDeps: MvRefreshDeps = { redis: deps.redis, logger: deps.logger };
  return startInterval(
    deps.intervalMs ?? DEFAULT_MV_TICK_MS,
    'dashboard mv scheduler',
    deps.logger,
    () => runMvRefreshTick(mvDeps),
  );
}

export {
  runSnapshotTick,
  type SnapshotDeps,
  type SnapshotTickResult,
} from './snapshot-job';
export { runMvRefreshTick, type MvRefreshDeps, type MvRefreshResult } from './mv-refresh-job';
export {
  DASHBOARD_SNAPSHOT_LOCK_KEY,
  DASHBOARD_MV_LOCK_KEY,
  DEFAULT_SNAPSHOT_TICK_MS,
  DEFAULT_MV_TICK_MS,
  type RedisLike,
} from './scheduler';
