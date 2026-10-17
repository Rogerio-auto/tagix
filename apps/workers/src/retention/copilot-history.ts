/**
 * Retenção do histórico do Copiloto (F73-S15; COPILOTO.md §4 `history_retention_months`, P7).
 *
 * Varredura DIÁRIA, singleton por lock Redis, em lotes, que respeita o prazo escolhido por cada
 * workspace (`copilot_settings.history_retention_months`: 6, 12 ou 24; sem linha = 12):
 *
 *   1. APAGA `copilot_messages` mais antigas que o prazo (a pergunta, o veredito e os cartões);
 *   2. APAGA `copilot_sessions` além do prazo que ficaram sem mensagem e SEM turno;
 *   3. ANONIMIZA as sessões além do prazo que ainda têm turno: título e último contexto de
 *      página saem e a sessão é arquivada (some da lista). A linha fica de âncora do turno.
 *
 * O QUE NUNCA É APAGADO (a trilha segue a política de auditoria existente, não este prazo):
 * `copilot_action_proposals` e `copilot_action_items`, `copilot_tool_calls`, `copilot_turns`,
 * `audit_logs` e `llm_usage_logs` (o custo do mês e a conta sobrevivem ao histórico).
 *
 * Por que o passo 3 existe: `copilot_turns.session_id` é NOT NULL com `ON DELETE CASCADE`, e
 * `copilot_tool_calls.turn_id` também cascateia. Apagar uma sessão que tem turno levaria o turno
 * e as chamadas de ferramenta junto, e a trilha ficaria sem o elo "esta ação veio deste turno".
 * Como todo turno nasce com a pergunta gravada, quase toda sessão real tem turno: o conteúdo
 * (mensagens, título, contexto) sai por inteiro, e só o casco sem texto permanece. Para apagar
 * também o casco bastaria o schema permitir `turns.session_id` nulo com `ON DELETE SET NULL`
 * (pendência registrada no relatório do slot).
 *
 * Cada lote roda sob `withWorkspace` do próprio tenant (RLS como cinto) e filtra por
 * `workspace_id` no SQL. O trabalho por tick é limitado (`batchSize * maxBatchesPerTick`);
 * sobra de backlog continua no tick seguinte.
 */
import { sql } from 'drizzle-orm';
import { getDb, schema, withWorkspace } from '@hm/db';
import type { Logger } from '@hm/logger';
import {
  acquireSweepLock,
  resolveRetentionConfig,
  type RedisLike,
  type RetentionConfig,
} from './config';

/** Lock singleton da varredura do histórico do Copiloto (mesmo padrão `hm:lock:scheduler:*`). */
export const COPILOT_HISTORY_LOCK_KEY = 'hm:lock:scheduler:copilot-history-retention' as const;
/** Posse máxima do lock por tick (o trabalho é limitado por `maxBatchesPerTick`). */
export const COPILOT_HISTORY_LOCK_TTL_MS = 10 * 60_000;
/** Prazo quando o workspace não tem linha em `copilot_settings` (default do schema). */
export const COPILOT_DEFAULT_RETENTION_MONTHS = 12;

/** Workspace com histórico do Copiloto e o prazo que ele escolheu. */
export interface CopilotRetentionTarget {
  readonly workspaceId: string;
  readonly retentionMonths: number;
}

/** Porta de banco da varredura (injetável; a real está em `createCopilotHistoryPort`). */
export interface CopilotHistoryPort {
  /** Workspaces que têm sessão do Copiloto, com o prazo de cada um. */
  listTargets(): Promise<CopilotRetentionTarget[]>;
  /** Apaga até `limit` mensagens com `created_at < cutoff`. */
  deleteMessages(workspaceId: string, cutoff: Date, limit: number): Promise<number>;
  /** Apaga até `limit` sessões além do prazo, sem mensagem e sem turno. */
  deleteSessions(workspaceId: string, cutoff: Date, limit: number): Promise<number>;
  /** Anonimiza e arquiva até `limit` sessões além do prazo, sem mensagem e com turno. */
  scrubSessions(workspaceId: string, cutoff: Date, limit: number): Promise<number>;
}

/** Subtrai `months` meses (UTC) preservando o dia, com o limite do fim do mês (31/mar − 1 → 28/fev). */
export function subtractMonths(at: Date, months: number): Date {
  const out = new Date(at.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}

export interface CopilotHistoryResult {
  readonly workspaces: number;
  readonly messagesDeleted: number;
  readonly sessionsDeleted: number;
  readonly sessionsScrubbed: number;
  readonly batches: number;
  /** Parou por atingir o teto de lotes com backlog restante (o próximo tick continua). */
  readonly reachedCap: boolean;
  /** Workspaces cuja varredura falhou (os demais seguem). */
  readonly errors: number;
}

export interface CopilotHistorySweepOptions {
  readonly now: Date;
  readonly batchSize: number;
  /** Teto de lotes por execução, somando todos os workspaces e fases. */
  readonly maxBatches: number;
  readonly onError?: (workspaceId: string, err: unknown) => void;
}

/** Varre todos os workspaces. Idempotente: repetir não apaga nada novo. */
export async function runCopilotHistorySweep(
  port: CopilotHistoryPort,
  opts: CopilotHistorySweepOptions,
): Promise<CopilotHistoryResult> {
  const batchSize = Math.max(1, opts.batchSize);
  let budget = Math.max(1, opts.maxBatches);
  const totals = { messagesDeleted: 0, sessionsDeleted: 0, sessionsScrubbed: 0, batches: 0 };
  let errors = 0;
  let reachedCap = false;

  const targets = await port.listTargets();
  type Phase = (ws: string, cutoff: Date, limit: number) => Promise<number>;
  const phases: ReadonlyArray<readonly [keyof typeof totals, Phase]> = [
    ['messagesDeleted', (ws, c, n) => port.deleteMessages(ws, c, n)],
    ['sessionsDeleted', (ws, c, n) => port.deleteSessions(ws, c, n)],
    ['sessionsScrubbed', (ws, c, n) => port.scrubSessions(ws, c, n)],
  ];

  outer: for (const target of targets) {
    const cutoff = subtractMonths(opts.now, target.retentionMonths);
    try {
      for (const [counter, run] of phases) {
        for (;;) {
          if (budget <= 0) {
            reachedCap = true;
            break outer;
          }
          const removed = await run(target.workspaceId, cutoff, batchSize);
          budget -= 1;
          totals.batches += 1;
          totals[counter] += removed;
          if (removed < batchSize) break; // fase drenada neste workspace
        }
      }
    } catch (err) {
      errors += 1;
      opts.onError?.(target.workspaceId, err);
    }
  }

  return {
    workspaces: targets.length,
    messagesDeleted: totals.messagesDeleted,
    sessionsDeleted: totals.sessionsDeleted,
    sessionsScrubbed: totals.sessionsScrubbed,
    batches: totals.batches,
    reachedCap,
    errors,
  };
}

/**
 * Porta real contra o Postgres. A listagem roda como owner (entre workspaces, no padrão dos
 * demais agendadores cross-tenant); cada lote roda sob `withWorkspace` do tenant.
 */
export function createCopilotHistoryPort(): CopilotHistoryPort {
  return {
    async listTargets(): Promise<CopilotRetentionTarget[]> {
      const rows = await getDb().execute<{ workspace_id: string; months: number }>(sql`
        select s.workspace_id as workspace_id,
               coalesce(st.history_retention_months, ${COPILOT_DEFAULT_RETENTION_MONTHS})::int as months
          from (select distinct workspace_id from ${schema.copilotSessions}) s
          left join ${schema.copilotSettings} st on st.workspace_id = s.workspace_id
         order by s.workspace_id
      `);
      return Array.from(rows, (r) => ({ workspaceId: r.workspace_id, retentionMonths: r.months }));
    },

    async deleteMessages(workspaceId, cutoff, limit) {
      return withWorkspace(workspaceId, async (tx) => {
        const rows = await tx.execute<{ id: string }>(sql`
          delete from ${schema.copilotMessages}
           where workspace_id = ${workspaceId}
             and id in (
               select cm.id from ${schema.copilotMessages} cm
                where cm.workspace_id = ${workspaceId} and cm.created_at < ${cutoff}
                limit ${limit})
          returning id
        `);
        return rows.length;
      });
    },

    async deleteSessions(workspaceId, cutoff, limit) {
      return withWorkspace(workspaceId, async (tx) => {
        const rows = await tx.execute<{ id: string }>(sql`
          delete from ${schema.copilotSessions}
           where workspace_id = ${workspaceId}
             and id in (
               select cs.id from ${schema.copilotSessions} cs
                where cs.workspace_id = ${workspaceId} and cs.updated_at < ${cutoff}
                  and not exists (select 1 from ${schema.copilotMessages} cm where cm.session_id = cs.id)
                  and not exists (select 1 from ${schema.copilotTurns} ct where ct.session_id = cs.id)
                limit ${limit})
          returning id
        `);
        return rows.length;
      });
    },

    async scrubSessions(workspaceId, cutoff, limit) {
      return withWorkspace(workspaceId, async (tx) => {
        const rows = await tx.execute<{ id: string }>(sql`
          update ${schema.copilotSessions}
             set title = null,
                 last_page_context = null,
                 archived_at = coalesce(archived_at, now())
           where workspace_id = ${workspaceId}
             and id in (
               select cs.id from ${schema.copilotSessions} cs
                where cs.workspace_id = ${workspaceId} and cs.updated_at < ${cutoff}
                  and (cs.title is not null or cs.last_page_context is not null or cs.archived_at is null)
                  and not exists (select 1 from ${schema.copilotMessages} cm where cm.session_id = cs.id)
                limit ${limit})
          returning id
        `);
        return rows.length;
      });
    },
  };
}

export interface CopilotHistoryRunDeps {
  readonly redis: RedisLike;
  readonly logger: Logger;
  readonly port: CopilotHistoryPort;
  readonly config: Pick<RetentionConfig, 'batchSize' | 'maxBatchesPerTick'>;
  readonly now: () => Date;
}

/**
 * UMA passada sob o lock singleton. `null` = outra instância está varrendo. Exportada para o
 * bootstrap e os testes dispararem um tick determinístico.
 */
export async function runCopilotHistoryOnce(
  deps: CopilotHistoryRunDeps,
): Promise<CopilotHistoryResult | null> {
  const release = await acquireSweepLock(
    deps.redis,
    COPILOT_HISTORY_LOCK_KEY,
    COPILOT_HISTORY_LOCK_TTL_MS,
  );
  if (!release) return null;
  try {
    const result = await runCopilotHistorySweep(deps.port, {
      now: deps.now(),
      batchSize: deps.config.batchSize,
      maxBatches: deps.config.maxBatchesPerTick,
      onError: (workspaceId, err) => {
        deps.logger.error('copilot history retention falhou para o workspace', {
          workspaceId,
          errorName: err instanceof Error ? err.name : typeof err,
        });
      },
    });
    if (
      result.messagesDeleted + result.sessionsDeleted + result.sessionsScrubbed > 0 ||
      result.reachedCap ||
      result.errors > 0
    ) {
      deps.logger.info('copilot history retention', { ...result });
    }
    return result;
  } finally {
    await release();
  }
}

export interface CopilotHistoryWorkerDeps {
  readonly redis: RedisLike;
  readonly logger: Logger;
  readonly config?: Partial<RetentionConfig>;
  readonly port?: CopilotHistoryPort;
  readonly now?: () => Date;
}

export interface CopilotHistoryWorkerHandle {
  stop(): Promise<void>;
}

/** Liga a varredura diária (primeiro tick com atraso, depois na cadência). */
export function startCopilotHistoryRetention(
  deps: CopilotHistoryWorkerDeps,
): CopilotHistoryWorkerHandle {
  const config: RetentionConfig = { ...resolveRetentionConfig(), ...deps.config };
  const port = deps.port ?? createCopilotHistoryPort();
  const now = deps.now ?? (() => new Date());
  let running = false;

  const tick = (): void => {
    if (running) return;
    running = true;
    void runCopilotHistoryOnce({ redis: deps.redis, logger: deps.logger, port, config, now })
      .catch((err: unknown) => {
        deps.logger.error('copilot history retention falhou', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };

  const initial = setTimeout(tick, config.initialDelayMs);
  initial.unref?.();
  const timer = setInterval(tick, config.intervalMs);
  timer.unref?.();

  deps.logger.info('copilot history retention iniciado', {
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
