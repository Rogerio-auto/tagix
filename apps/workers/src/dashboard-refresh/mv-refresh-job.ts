/**
 * Job de refresh das materialized views do dashboard (F8-S02 / DASHBOARD.md §5,
 * cadência 1h/1d). `REFRESH MATERIALIZED VIEW CONCURRENTLY` em cada mv_dashboard_*
 * (cada uma tem UNIQUE index → CONCURRENTLY não bloqueia leitura).
 *
 * Cross-tenant: as MVs são globais (não têm RLS); rodamos como owner via `getDb()`.
 * Singleton por lock Redis dedicado.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '@hm/db';
import type { Logger } from '@hm/logger';
import {
  acquireSchedulerLock,
  DASHBOARD_LOCK_TTL_MS,
  DASHBOARD_MV_LOCK_KEY,
  type RedisLike,
} from './scheduler';

export interface MvRefreshDeps {
  readonly redis: RedisLike;
  readonly logger: Logger;
}

export interface MvRefreshResult {
  readonly ran: boolean;
  readonly refreshed: number;
}

const MATERIALIZED_VIEWS = [
  'mv_dashboard_volume_24h',
  'mv_dashboard_llm_cost_month',
  'mv_dashboard_conversions_month',
  'mv_dashboard_daily_30d',
] as const;

export async function runMvRefreshTick(deps: MvRefreshDeps): Promise<MvRefreshResult> {
  const release = await acquireSchedulerLock(
    deps.redis,
    DASHBOARD_MV_LOCK_KEY,
    DASHBOARD_LOCK_TTL_MS,
  );
  if (release === null) return { ran: false, refreshed: 0 };

  try {
    let refreshed = 0;
    const db = getDb();
    for (const view of MATERIALIZED_VIEWS) {
      try {
        await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`));
        refreshed += 1;
      } catch (err: unknown) {
        deps.logger.error('dashboard-refresh: REFRESH MV falhou', {
          view,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    deps.logger.info('dashboard-refresh: mv tick', { refreshed });
    return { ran: true, refreshed };
  } finally {
    await release();
  }
}
