/**
 * Cron de on_stale (PIPELINE.md 3.4 + 14 anti-loop). Tick diario: encontra deals
 * parados (updated_at < now - staleAfterDays) em stages com regra on_stale enabled,
 * e agenda essas regras em pending_automations.
 *
 * Guard anti-loop (14): por deal/dia, no maximo MAX_AUTOMOVES_PER_DEAL_PER_DAY
 * automacoes on_stale agendadas — evita que um deal preso re-dispare em loop. O
 * guard usa pending_automations (count das criadas hoje p/ o deal via on_stale).
 */
import { sql } from 'drizzle-orm';
import { getDb } from '@hm/db';
import type { Logger } from '@hm/logger';
import { acquireSchedulerLock, type RedisLike } from '../flows/scheduler';
import type { AutomationRule } from './types';

export const STALE_LOCK_KEY = 'hm:lock:scheduler:automations-stale' as const;
export const STALE_LOCK_TTL_MS = 60_000;
export const DEFAULT_STALE_TICK_MS = 24 * 60 * 60_000;
export const MAX_AUTOMOVES_PER_DEAL_PER_DAY = 3;

interface StaleCandidate {
  readonly dealId: string;
  readonly workspaceId: string;
  readonly rules: AutomationRule[];
  readonly daysStale: number;
}

/**
 * Seleciona deals parados cujo stage tem regra on_stale enabled. Usa
 * jsonb_array_elements p/ checar o trigger; o filtro fino por staleAfterDays
 * roda em JS (cada regra tem seu proprio N).
 */
async function selectStale(now: Date, limit: number): Promise<StaleCandidate[]> {
  const rows = await getDb().execute<{
    deal_id: string;
    workspace_id: string;
    rules: AutomationRule[];
    days_stale: number;
  }>(sql`
    select d.id as deal_id, d.workspace_id, s.automation_rules as rules,
           extract(epoch from (${now} - coalesce(d.updated_at, d.created_at))) / 86400 as days_stale
    from deals d
    join stages s on s.id = d.stage_id
    where d.closed_at is null
      and exists (
        select 1 from jsonb_array_elements(s.automation_rules) as rule
        where rule->>'trigger' = 'on_stale' and rule->>'enabled' = 'true'
      )
    order by d.updated_at asc nulls first
    limit ${limit}
  `);
  return [...rows].map((r) => ({
    dealId: r.deal_id,
    workspaceId: r.workspace_id,
    rules: (r.rules ?? []) as AutomationRule[],
    daysStale: Number(r.days_stale),
  }));
}

/** Conta automacoes on_stale agendadas HOJE p/ o deal (guard anti-loop). */
async function automovesToday(dealId: string): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(sql`
    select count(*)::int as n
    from pending_automations
    where deal_id = ${dealId}
      and created_at >= date_trunc('day', now())
      and rule->>'trigger' = 'on_stale'
  `);
  return rows[0]?.n ?? 0;
}

export interface StaleDeps {
  readonly redis: RedisLike;
  readonly logger: Logger;
  readonly selectStale?: (now: Date, limit: number) => Promise<StaleCandidate[]>;
}

export interface StaleTickResult {
  readonly ran: boolean;
  readonly enqueued: number;
}

/** Um tick on_stale: para cada deal parado, agenda regras on_stale vencidas (com guard). */
export async function runStaleTick(
  deps: StaleDeps,
  options: { now?: Date; limit?: number } = {},
): Promise<StaleTickResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 500;
  const release = await acquireSchedulerLock(deps.redis, STALE_LOCK_KEY, STALE_LOCK_TTL_MS);
  if (release === null) return { ran: false, enqueued: 0 };
  try {
    const select = deps.selectStale ?? selectStale;
    const candidates = await select(now, limit);
    let enqueued = 0;
    for (const c of candidates) {
      const ripe = c.rules.filter(
        (r) =>
          r.trigger === 'on_stale' &&
          r.enabled &&
          c.daysStale >= (r.staleAfterDays ?? Number.POSITIVE_INFINITY),
      );
      if (ripe.length === 0) continue;
      const already = await automovesToday(c.dealId);
      const budget = Math.max(0, MAX_AUTOMOVES_PER_DEAL_PER_DAY - already);
      const toSchedule = ripe.slice(0, budget);
      if (toSchedule.length === 0) {
        deps.logger.debug('automations(stale): guard anti-loop bloqueou deal', { dealId: c.dealId });
        continue;
      }
      await getDb().execute(sql`
        insert into pending_automations (workspace_id, deal_id, rule, scheduled_at, status)
        select ${c.workspaceId}, ${c.dealId}, r, ${now}, 'pending'
        from jsonb_array_elements(${JSON.stringify(toSchedule)}::jsonb) as r
      `);
      enqueued += toSchedule.length;
    }
    if (enqueued > 0) deps.logger.info('automations(stale): agendadas', { enqueued });
    return { ran: true, enqueued };
  } finally {
    await release();
  }
}

export function startStaleScheduler(
  deps: StaleDeps,
  options: { intervalMs?: number } = {},
): { stop(): Promise<void> } {
  const intervalMs = options.intervalMs ?? DEFAULT_STALE_TICK_MS;
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void runStaleTick(deps)
      .catch((err: unknown) => {
        deps.logger.error('automations(stale): tick falhou', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  deps.logger.info('automation stale scheduler iniciado', { intervalMs });
  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      await Promise.resolve();
    },
  };
}

export type { StaleCandidate };
