/**
 * Drainer de pending_automations (PIPELINE.md 3.3). Tick cron (default 30s):
 * seleciona automacoes vencidas (scheduled_at <= now, status pending), executa
 * via `ActionExecutor` injetado, e em falha aplica retry/backoff (max 3 -> failed).
 *
 * Singleton entre instancias via lock Redis (mesmo padrao do flow-wakeup F4-S03).
 * SELECT ... FOR UPDATE SKIP LOCKED garante que 2 ticks nao peguem a mesma linha.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '@hm/db';
import type { Logger } from '@hm/logger';
import { acquireSchedulerLock, recordSchedulerTick, type RedisLike } from '../flows/scheduler';
import type { ActionExecutor, PendingAutomationRow } from './types';

export const AUTOMATION_LOCK_KEY = 'hm:lock:scheduler:automations' as const;
export const AUTOMATION_LOCK_TTL_MS = 30_000;
export const DEFAULT_AUTOMATION_TICK_MS = 30_000;
export const MAX_ATTEMPTS = 3;
const BATCH = 50;

/** Backoff exponencial simples: 30s, 2min, 8min. */
export function backoffMs(attempt: number): number {
  return 30_000 * 4 ** Math.max(0, attempt - 1);
}

/**
 * Serializa um erro de tick para log. Drizzle envolve a falha do driver em
 * "Failed query: …" e o `.message` esconde a causa REAL (postgres.js anexa
 * `code`/`severity`/`detail` direto no erro, ou em `.cause`). Captura esses
 * campos sem `any` para a falha intermitente deixar de ser opaca.
 */
export function describeTickError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { error: String(err) };
  const rec = err as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { error: err.message, stack: err.stack };
  for (const k of ['code', 'severity', 'detail', 'routine', 'constraint', 'where']) {
    if (rec[k] !== undefined) out[k] = rec[k];
  }
  const cause = rec['cause'];
  if (cause !== undefined) {
    out['cause'] = cause instanceof Error ? cause.message : String(cause);
    const causeCode = (cause as Record<string, unknown> | null)?.['code'];
    if (causeCode !== undefined) out['causeCode'] = causeCode;
  }
  return out;
}

export type SelectDuePort = (now: Date, limit: number) => Promise<PendingAutomationRow[]>;

/** Seleciona automacoes vencidas (cross-tenant, owner bypassa RLS). */
async function selectDue(now: Date, limit: number): Promise<PendingAutomationRow[]> {
  const rows = await getDb().execute<{
    id: string;
    workspace_id: string;
    deal_id: string;
    rule: PendingAutomationRow['rule'];
    attempts: number;
  }>(sql`
    select id, workspace_id, deal_id, rule, attempts
    from pending_automations
    where status = 'pending' and scheduled_at <= ${now.toISOString()}
    order by scheduled_at asc
    limit ${limit}
    for update skip locked
  `);
  return [...rows].map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    dealId: r.deal_id,
    rule: r.rule,
    attempts: r.attempts,
  }));
}

async function markDone(id: string): Promise<void> {
  await getDb().execute(sql`update pending_automations set status = 'done' where id = ${id}`);
}

async function markRetryOrFail(row: PendingAutomationRow, err: unknown, now: Date): Promise<void> {
  const attempts = row.attempts + 1;
  const lastError = err instanceof Error ? err.message : String(err);
  if (attempts >= MAX_ATTEMPTS) {
    await getDb().execute(sql`
      update pending_automations
      set attempts = ${attempts}, last_error = ${lastError}, status = 'failed'
      where id = ${row.id}
    `);
    return;
  }
  const next = new Date(now.getTime() + backoffMs(attempts));
  await getDb().execute(sql`
    update pending_automations
    set attempts = ${attempts}, last_error = ${lastError}, scheduled_at = ${next.toISOString()}
    where id = ${row.id}
  `);
}

export interface AutomationDeps {
  readonly redis: RedisLike;
  readonly logger: Logger;
  readonly execute: ActionExecutor;
  readonly selectDue?: SelectDuePort;
}

export interface AutomationTickResult {
  readonly ran: boolean;
  readonly processed: number;
  readonly failed: number;
}

/** Um tick do drainer: lock singleton -> drena due -> executa -> retry/fail. */
export async function runAutomationTick(
  deps: AutomationDeps,
  options: { now?: Date; limit?: number } = {},
): Promise<AutomationTickResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? BATCH;
  const release = await acquireSchedulerLock(deps.redis, AUTOMATION_LOCK_KEY, AUTOMATION_LOCK_TTL_MS);
  if (release === null) {
    deps.logger.debug('automations: tick pulado — lock detido por outra instancia');
    return { ran: false, processed: 0, failed: 0 };
  }
  try {
    const select = deps.selectDue ?? selectDue;
    const due = await select(now, limit);
    let processed = 0;
    let failed = 0;
    for (const row of due) {
      try {
        await deps.execute(row);
        await markDone(row.id);
        processed += 1;
      } catch (err: unknown) {
        await markRetryOrFail(row, err, now);
        failed += 1;
        deps.logger.warn('automations: action falhou', {
          id: row.id,
          attempt: row.attempts + 1,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (processed > 0 || failed > 0) {
      deps.logger.info('automations: tick concluido', { processed, failed });
    }
    recordSchedulerTick('automations', 'success');
    return { ran: true, processed, failed };
  } catch (err: unknown) {
    // Falha no nível do TICK (ex.: SELECT vencidas falhou): observável por métrica.
    // Falhas de ação individual são tratadas no loop e NÃO derrubam o tick.
    recordSchedulerTick('automations', 'failed');
    throw err;
  } finally {
    await release();
  }
}

export function automationTickMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['AUTOMATION_TICK_MS'];
  if (raw === undefined || raw.length === 0) return DEFAULT_AUTOMATION_TICK_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AUTOMATION_TICK_MS;
}

export interface AutomationWorkerHandle {
  stop(): Promise<void>;
}

/** Inicia o drainer: dispara runAutomationTick a cada intervalMs (anti-reentrancia). */
export function startAutomationWorker(
  deps: AutomationDeps,
  options: { intervalMs?: number } = {},
): AutomationWorkerHandle {
  const intervalMs = options.intervalMs ?? automationTickMsFromEnv();
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void runAutomationTick(deps)
      .catch((err: unknown) => {
        deps.logger.error('automations: tick falhou', describeTickError(err));
      })
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  deps.logger.info('automation worker iniciado', { intervalMs });
  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      await Promise.resolve();
    },
  };
}
