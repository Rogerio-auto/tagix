/**
 * Scheduler de wakeup de flows (F4-S03). Tick cron (default 60s) que varre o indice parcial
 * `idx_flow_executions_status_next` (`status='waiting' AND next_step_at <= now()`) e
 * RE-ENFILEIRA cada execucao vencida em `hm.q.flow.execution`. NAO processa — todo o
 * trabalho roda no consumer (worker.ts), mantendo um unico caminho de execucao.
 *
 * Timeouts de `wait` e `wait_for_response`/`external_notify` (biestaveis) vencem aqui: ao
 * re-enfileirar, o consumer reprocessa o node; o handler ve o marker e segue pela edge
 * `timeout`. Singleton entre instancias via lock Redis (mesmo padrao do follow-up F2-S21).
 */
import { Buffer } from 'node:buffer';
import { sql } from 'drizzle-orm';
import { getDb } from '@hm/db';
import {
  FLOW_EXECUTION_ROUTING_KEY,
  FLOW_EXECUTION_STEP_TYPE,
  makeEnvelope,
  QUEUES,
  type MqHandle,
} from '@hm/shared/mq';
import { getMeter, type Logger } from '@hm/logger';

type MqChannel = MqHandle['channel'];

/**
 * Observabilidade de ticks de scheduler (F52-S09). Counter OTel ÚNICO compartilhado
 * por todos os schedulers (flow-wakeup + automations), rotulado por `scheduler` e
 * `result` — fim do logging cego: um tick que FALHA passa a ser observável por
 * métrica (não só por uma linha de log). Usa o `Meter` já configurado (@hm/logger /
 * F10-S01): quando a telemetria OTLP está ligada o collector recebe; quando não,
 * o meter é no-op (zero overhead). NÃO introduz novo stack de métrica.
 */
const schedulerMeter = getMeter('@hm/workers');
const schedulerTickCounter = schedulerMeter.createCounter('hm.scheduler.tick', {
  description: 'Ticks de scheduler executados, por scheduler e resultado (success/failed).',
});

export type SchedulerTickResult = 'success' | 'failed';

/** Registra o resultado de um tick de scheduler (success/failed) por nome de scheduler. */
export function recordSchedulerTick(scheduler: string, result: SchedulerTickResult): void {
  schedulerTickCounter.add(1, { scheduler, result });
}

export const FLOW_EXECUTION_QUEUE = QUEUES.flowExecution;

/** Lock singleton do scheduler de flows (so 1 instancia roda o tick). */
export const FLOW_SCHEDULER_LOCK_KEY = 'hm:lock:scheduler:flow-wakeup' as const;
export const FLOW_SCHEDULER_LOCK_TTL_MS = 30_000;
export const DEFAULT_FLOW_TICK_MS = 60_000;
/** Teto de execucoes re-enfileiradas por tick (evita avalanche; o resto vem no proximo). */
const MAX_WAKEUPS_PER_TICK = 500;

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

/** Execucao vencida (apenas o necessario para re-enfileirar). */
interface DueExecution {
  readonly workspaceId: string;
  readonly executionId: string;
}

/**
 * Seleciona execucoes WAITING vencidas (cross-tenant: getDb() direto, como o enumerador
 * de tenants do follow-up). Usa o indice parcial `idx_flow_executions_status_next`.
 */
async function selectDue(now: Date, limit: number): Promise<DueExecution[]> {
  // postgres-js NÃO serializa um Date cru passado a um template `sql` (drizzle não
  // conhece o tipo-alvo aqui, diferente do query builder): falha com
  // "Received an instance of Date". Passamos o timestamp como ISO string — o Postgres
  // coage para timestamptz na comparação. Sem isto, TODO tick falhava e nenhum `wait`/
  // `wait_for_response`/timeout jamais retomava.
  const rows = await getDb().execute<
    { id: string; workspace_id: string } & Record<string, unknown>
  >(sql`
    select id, workspace_id
    from flow_executions
    where status = 'waiting'
      and next_step_at is not null
      and next_step_at <= ${now.toISOString()}
    order by next_step_at asc
    limit ${limit}
  `);
  return [...rows].map((r) => ({ workspaceId: r.workspace_id, executionId: r.id }));
}

/** Re-enfileira um step em `hm.q.flow.execution` (mesmo contrato da engine). */
function publishStep(channel: MqChannel, due: DueExecution): void {
  const envelope = makeEnvelope(FLOW_EXECUTION_STEP_TYPE, due.workspaceId, {
    workspaceId: due.workspaceId,
    executionId: due.executionId,
  });
  channel.publish('hm.events', FLOW_EXECUTION_ROUTING_KEY, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
}

/** Porta de consulta de execucoes vencidas (DI: default = query no Postgres). */
export type SelectDuePort = (now: Date, limit: number) => Promise<DueExecution[]>;

export interface FlowSchedulerDeps {
  readonly redis: RedisLike;
  readonly channel: MqChannel;
  readonly logger: Logger;
  /** override da selecao de vencidas (testes injetam um fake; default = selectDue DB). */
  readonly selectDue?: SelectDuePort;
}

export interface FlowTickOptions {
  readonly now?: Date;
  readonly limit?: number;
}

export interface FlowTickResult {
  readonly ran: boolean;
  readonly enqueued: number;
}

/**
 * Um tick: adquire o lock singleton; se outra instancia o detem, retorna ran:false. Senao,
 * busca execucoes vencidas e re-enfileira cada uma. Libera o lock ao final (mesmo em erro).
 */
export async function runFlowWakeupTick(
  deps: FlowSchedulerDeps,
  options: FlowTickOptions = {},
): Promise<FlowTickResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? MAX_WAKEUPS_PER_TICK;

  const release = await acquireSchedulerLock(
    deps.redis,
    FLOW_SCHEDULER_LOCK_KEY,
    FLOW_SCHEDULER_LOCK_TTL_MS,
  );
  if (release === null) {
    deps.logger.debug('flow-wakeup: tick pulado — lock detido por outra instancia');
    return { ran: false, enqueued: 0 };
  }

  try {
    const select = deps.selectDue ?? selectDue;
    const due = await select(now, limit);
    for (const item of due) {
      publishStep(deps.channel, item);
    }
    if (due.length > 0) {
      deps.logger.info('flow-wakeup: execucoes re-enfileiradas', { enqueued: due.length });
    }
    recordSchedulerTick('flow-wakeup', 'success');
    return { ran: true, enqueued: due.length };
  } catch (err: unknown) {
    // Tick falhou (ex.: DB indisponível): observável por métrica, não só por log.
    recordSchedulerTick('flow-wakeup', 'failed');
    throw err;
  } finally {
    await release();
  }
}

export function flowTickMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['FLOW_WAKEUP_TICK_MS'];
  if (raw === undefined || raw.length === 0) return DEFAULT_FLOW_TICK_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FLOW_TICK_MS;
}

export interface FlowSchedulerHandle {
  stop(): Promise<void>;
}

export interface FlowSchedulerOptions {
  readonly intervalMs?: number;
}

/**
 * Inicia o scheduler: dispara `runFlowWakeupTick` a cada `intervalMs`. Flag de reentrancia
 * evita empilhar ticks; erros sao logados e nao derrubam o scheduler. `unref` para nao
 * impedir o encerramento do processo.
 */
export function startFlowWakeupScheduler(
  deps: FlowSchedulerDeps,
  options: FlowSchedulerOptions = {},
): FlowSchedulerHandle {
  const intervalMs = options.intervalMs ?? flowTickMsFromEnv();
  let running = false;

  const tick = (): void => {
    if (running) {
      deps.logger.debug('flow-wakeup: tick anterior ainda em execucao — disparo pulado');
      return;
    }
    running = true;
    void runFlowWakeupTick(deps)
      .catch((err: unknown) => {
        deps.logger.error('flow-wakeup: tick falhou', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  deps.logger.info('flow-wakeup scheduler iniciado', { intervalMs });

  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      deps.logger.info('flow-wakeup scheduler parado');
      await Promise.resolve();
    },
  };
}

export type { DueExecution, MqChannel };
