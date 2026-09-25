/**
 * Scheduler de wakeup de flows (F4-S03). Tick cron (default 60s) que varre o indice parcial
 * `idx_flow_executions_status_next` (`status='waiting' AND next_step_at <= now()`) e
 * RE-ENFILEIRA cada execucao vencida em `hm.q.flow.execution`. NAO processa — todo o
 * trabalho roda no consumer (worker.ts), mantendo um unico caminho de execucao.
 *
 * Timeouts de `wait` e `wait_for_response`/`external_notify` (biestaveis) vencem aqui: ao
 * re-enfileirar, o consumer reprocessa o node; o handler ve o marker e segue pela edge
 * `timeout`. Singleton entre instancias via lock Redis (mesmo padrao do follow-up F2-S21).
 *
 * ## Recuperacao de `running` parada (F70-S25)
 * Desde a F70-S25 o passo de cada transicao entra na outbox com ela, entao uma execucao
 * `running` sem passo nao deveria mais nascer. Sobram as herdadas e as que perderam o
 * envelope depois da publicacao (DLQ, fila purgada). O mesmo tick as reanima:
 *
 * - **Parada:** `running` com `coalesce(updated_at, started_at)` mais velho que
 *   `FLOW_RUNNING_STALE_MS` (default 5 min). Uma execucao `running` so espera o proprio
 *   envelope, que chega em segundos.
 * - **Reivindicacao:** um UPDATE condicional bumpa `updated_at` so se a linha ainda esta
 *   `running` e parada, e o job do passo entra na outbox NA MESMA transacao. Duas
 *   instancias concorrentes (o lock Redis e a primeira barreira, esta e a segunda) nao
 *   reanimam a mesma execucao: com `SKIP LOCKED` uma pula a linha travada pela outra, e
 *   quem a rele depois do commit ja a ve fresca. Um tick seguinte so a reanima de novo
 *   depois de outro intervalo inteiro parada.
 * - **Passo unico:** o job reanimado passa pelo claim atomico do consumer (F56-S13). Se o
 *   envelope original so estava atrasado, os dois disputam o claim: um roda o passo, o
 *   outro perde (`in_flight`) ou encontra a execucao ja adiante — o mesmo passo nunca roda
 *   duas vezes.
 * - **Velha demais:** parada ha mais que `FLOW_RUNNING_MAX_AGE_MS` (default 24 h) NAO e
 *   reanimada — mandar agora a mensagem de um flow disparado ha dias e pior que nao
 *   mandar. Vira `failed` com o motivo em `last_error`, e o log avisa.
 */
import { Buffer } from 'node:buffer';
import { sql } from 'drizzle-orm';
import { enqueueOutbox, getDb } from '@hm/db';
import {
  FLOW_EXECUTION_ROUTING_KEY,
  FLOW_EXECUTION_STEP_TYPE,
  flowExecutionStepOutbox,
  makeEnvelope,
  QUEUES,
  type MqHandle,
} from '@hm/shared/mq';
import { getMeter, type Logger } from '@hm/logger';
import { recordSchedulerHeartbeat } from '../observability/health';

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

/** Renova o TTL SOMENTE se ainda formos o dono (compare-and-pexpire, atômico). */
const RENEW_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

export type ReleaseLock = () => Promise<void>;

export interface AcquireLockOptions {
  /**
   * Watchdog (INF-10): renova o TTL a cada `renewIntervalMs` enquanto o lock é
   * detido, para que um tick MAIS LONGO que o TTL não deixe o lock expirar (e
   * abra a porta a um segundo tick concorrente). Default = `ttlMs/3`.
   */
  readonly renewIntervalMs?: number;
  /** Chamado se a renovação falhar (lock perdido/roubado) — para logging. */
  readonly onRenewFailure?: (detail: { readonly key: string }) => void;
}

/**
 * Adquire o lock singleton via `SET NX PX`. Enquanto detido, um watchdog renova o
 * TTL periodicamente (compare-and-pexpire pelo token) — assim o lock não expira no
 * meio de um tick longo. O `ReleaseLock` retornado para o watchdog e libera o lock
 * (só se ainda formos o dono). Idempotente.
 */
export async function acquireSchedulerLock(
  redis: RedisLike,
  key: string,
  ttlMs: number,
  options: AcquireLockOptions = {},
): Promise<ReleaseLock | null> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (ok !== 'OK') return null;

  let released = false;
  const renewIntervalMs = options.renewIntervalMs ?? Math.max(1, Math.floor(ttlMs / 3));
  const watchdog = setInterval(() => {
    if (released) return;
    void (async () => {
      const res = await redis.eval(RENEW_LUA, 1, key, token, String(ttlMs));
      // 0/'0' = já não somos o dono (o lock expirou e foi retomado): avisa.
      if (res === 0 || res === '0') options.onRenewFailure?.({ key });
    })().catch(() => options.onRenewFailure?.({ key }));
  }, renewIntervalMs);
  watchdog.unref?.();

  return async () => {
    if (released) return;
    released = true;
    clearInterval(watchdog);
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

// ─── Recuperacao de `running` parada (F70-S25) ────────────────────────────────

/** Parada ha mais que isto (sem transicao) = passo perdido. */
export const DEFAULT_FLOW_RUNNING_STALE_MS = 5 * 60_000;
/** Parada ha mais que isto = velha demais para reanimar; vira `failed`. */
export const DEFAULT_FLOW_RUNNING_MAX_AGE_MS = 24 * 60 * 60_000;
/** Piso do limite de parada: abaixo disso a recuperacao competiria com a entrega normal. */
export const MIN_FLOW_RUNNING_STALE_MS = 60_000;
/** Teto de execucoes reanimadas (e de expiradas) por tick. */
const MAX_RECOVERIES_PER_TICK = 200;

/** `last_error` da execucao expirada (texto para o operador, no cockpit). */
export const FLOW_RUNNING_EXPIRED_ERROR =
  'execucao parada sem passo alem do limite de recuperacao; nao retomada';

export interface RunningRecoveryConfig {
  /** Limite de parada (ms). */
  readonly staleAfterMs: number;
  /** Idade maxima para reanimar (ms); acima disso a execucao expira. */
  readonly maxAgeMs: number;
}

function positiveMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.length === 0) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Le `FLOW_RUNNING_STALE_MS` e `FLOW_RUNNING_MAX_AGE_MS`. O limite de parada tem piso de
 * 1 min, e a idade maxima nunca fica abaixo dele (senao nada seria reanimado).
 */
export function runningRecoveryFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RunningRecoveryConfig {
  const staleAfterMs = Math.max(
    MIN_FLOW_RUNNING_STALE_MS,
    positiveMs(env['FLOW_RUNNING_STALE_MS'], DEFAULT_FLOW_RUNNING_STALE_MS),
  );
  const maxAgeMs = Math.max(
    staleAfterMs,
    positiveMs(env['FLOW_RUNNING_MAX_AGE_MS'], DEFAULT_FLOW_RUNNING_MAX_AGE_MS),
  );
  return { staleAfterMs, maxAgeMs };
}

/** Resultado de uma rodada de recuperacao. */
export interface RunningRecoveryResult {
  /** Execucoes reanimadas (um passo gravado na outbox para cada). */
  readonly recovered: readonly DueExecution[];
  /** Execucoes velhas demais, marcadas `failed`. */
  readonly expired: readonly DueExecution[];
}

/** Porta da recuperacao (DI: default = {@link recoverStaleRunning} no Postgres). */
export type RecoverRunningPort = (
  config: RunningRecoveryConfig,
  limit: number,
) => Promise<RunningRecoveryResult>;

type ExecutionRow = { id: string; workspace_id: string } & Record<string, unknown>;

function toDue(rows: Iterable<ExecutionRow>): DueExecution[] {
  return [...rows].map((r) => ({ workspaceId: r.workspace_id, executionId: r.id }));
}

/**
 * Reanima as `running` paradas e expira as velhas demais (ver doc do modulo), numa
 * transacao so pelo papel de conexao dos workers (cross-tenant, como `selectDue`; o papel
 * grava na outbox pela policy do relay). Commit grava a reivindicacao e os passos juntos;
 * rollback, nenhum — o proximo tick tenta de novo.
 *
 * A comparacao de tempo usa o relogio do Postgres (`now()`), o mesmo do claim e do lease.
 */
export async function recoverStaleRunning(
  config: RunningRecoveryConfig,
  limit: number,
): Promise<RunningRecoveryResult> {
  const since = sql`coalesce(updated_at, started_at)`;
  const staleCut = sql`now() - (${Math.floor(config.staleAfterMs)}::double precision * interval '1 millisecond')`;
  const ageCut = sql`now() - (${Math.floor(config.maxAgeMs)}::double precision * interval '1 millisecond')`;
  const batch = Math.max(1, Math.floor(limit));

  return getDb().transaction(async (tx) => {
    // Reivindicacao: UPDATE condicional. O CTE trava as candidatas (SKIP LOCKED: duas
    // instancias repartem, nao disputam); o WHERE do UPDATE repete a condicao, entao uma
    // linha que outra transacao acabou de reanimar (ou que o consumer reivindicou) fica de
    // fora ao ser relida.
    const recovered = toDue(
      await tx.execute<ExecutionRow>(sql`
        with stale as (
          select id
          from flow_executions
          where status = 'running'
            and ${since} <= ${staleCut}
            and ${since} > ${ageCut}
          order by ${since} asc
          limit ${batch}
          for update skip locked
        )
        update flow_executions f
           set updated_at = now()
          from stale
         where f.id = stale.id
           and f.status = 'running'
           and coalesce(f.updated_at, f.started_at) <= ${staleCut}
        returning f.id, f.workspace_id
      `),
    );
    await enqueueOutbox(
      tx,
      recovered.map((r) => flowExecutionStepOutbox(r.workspaceId, r.executionId)),
    );

    const expired = toDue(
      await tx.execute<ExecutionRow>(sql`
        with old as (
          select id
          from flow_executions
          where status = 'running'
            and ${since} <= ${ageCut}
          order by ${since} asc
          limit ${batch}
          for update skip locked
        )
        update flow_executions f
           set status = 'failed',
               last_error = ${FLOW_RUNNING_EXPIRED_ERROR},
               completed_at = now(),
               updated_at = now()
          from old
         where f.id = old.id
           and f.status = 'running'
           and coalesce(f.updated_at, f.started_at) <= ${ageCut}
        returning f.id, f.workspace_id
      `),
    );

    return { recovered, expired };
  });
}

export interface FlowSchedulerDeps {
  readonly redis: RedisLike;
  readonly channel: MqChannel;
  readonly logger: Logger;
  /** override da selecao de vencidas (testes injetam um fake; default = selectDue DB). */
  readonly selectDue?: SelectDuePort;
  /** override da recuperacao de `running` parada (default = {@link recoverStaleRunning}). */
  readonly recoverRunning?: RecoverRunningPort;
  /** limites da recuperacao (default = {@link runningRecoveryFromEnv}). */
  readonly runningRecovery?: RunningRecoveryConfig;
}

export interface FlowTickOptions {
  readonly now?: Date;
  readonly limit?: number;
}

export interface FlowTickResult {
  readonly ran: boolean;
  /** `waiting` vencidas republicadas. */
  readonly enqueued: number;
  /** `running` paradas reanimadas (passo gravado na outbox). */
  readonly recovered: number;
  /** `running` paradas alem da idade maxima, marcadas `failed`. */
  readonly expired: number;
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
    {
      onRenewFailure: ({ key }) =>
        deps.logger.warn('flow-wakeup: renovação do lock falhou (lock perdido)', { key }),
    },
  );
  // Heartbeat do scheduler (para o /healthz detectar tick travado — INF-07). O
  // tick executou (mesmo pulado por lock alheio): o processo está vivo e no prazo.
  // Usa wall-clock real (não o `now` lógico, que pode ser simulado em teste).
  recordSchedulerHeartbeat('flow-wakeup');
  if (release === null) {
    deps.logger.debug('flow-wakeup: tick pulado — lock detido por outra instancia');
    return { ran: false, enqueued: 0, recovered: 0, expired: 0 };
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

    // F70-S25: `running` parada — reanima (passo na outbox) ou expira.
    const recover = deps.recoverRunning ?? recoverStaleRunning;
    const recovery = await recover(
      deps.runningRecovery ?? runningRecoveryFromEnv(),
      Math.min(limit, MAX_RECOVERIES_PER_TICK),
    );
    if (recovery.recovered.length > 0) {
      deps.logger.warn('flow-wakeup: execucoes running paradas reanimadas', {
        recovered: recovery.recovered.length,
        executionIds: recovery.recovered.map((r) => r.executionId),
      });
    }
    if (recovery.expired.length > 0) {
      deps.logger.error('flow-wakeup: execucoes running paradas alem da idade maxima falhadas', {
        expired: recovery.expired.length,
        executionIds: recovery.expired.map((r) => r.executionId),
      });
    }

    recordSchedulerTick('flow-wakeup', 'success');
    return {
      ran: true,
      enqueued: due.length,
      recovered: recovery.recovered.length,
      expired: recovery.expired.length,
    };
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
