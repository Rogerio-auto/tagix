/**
 * Wakeup DURÁVEL do buffer de agregação da IA (F56-S15 / AUDITORIA §3.2 INF-06).
 *
 * O buffer (`buffer.ts`) agrupa as mensagens fragmentadas do cliente numa janela
 * (`agents.aggregation_window_sec`) e só então acorda o agente. Até aqui, o wakeup
 * desse flush era um `setTimeout` **in-process**: se o worker reiniciasse durante a
 * janela (deploy, crash, OOM), o timer morria com o processo — os itens continuavam
 * no Redis, mas **nada** os flushava. Resultado: a IA nunca respondia àquele turno.
 * Falha silenciosa, sem alarme, com o cliente esperando no vácuo.
 *
 * Este scheduler é a fonte de verdade do wakeup. Mesma mecânica dos demais
 * schedulers do repo (`flows/scheduler.ts`, `agents/followup.ts`): tick periódico,
 * **singleton entre instâncias** via lock Redis (`SET NX PX` + unlock Lua por token),
 * varrendo um índice DURÁVEL de deadlines e re-entregando o trabalho ao caminho de
 * execução único (`buffer.flush`) — o scheduler não duplica lógica de flush.
 *
 * ```
 * tick (a cada AGG_FLUSH_TICK_MS, default 5s — a janela é de 15-30s):
 *   acquireSchedulerLock(hm:lock:scheduler:agg-flush)   ← singleton
 *     [a cada RECONCILE_MS] reconcile():
 *        SCAN hm:agg:deadline:*  → membros ausentes do índice → ZADD  (auto-cura:
 *        janelas escritas por uma versão ANTERIOR — as que estavam no ar no momento
 *        do deploy deste fix — não têm entrada no ZSET e seriam perdidas)
 *     ZRANGEBYSCORE hm:agg:pending -inf {now} LIMIT 0 {MAX_FLUSHES_PER_TICK}
 *     para cada conversa vencida: buffer.flush(conv)    ← lock por conversa + drain
 *   release()
 * ```
 *
 * **Idempotência:** `buffer.flush` já é idempotente (lock por conversa + drain
 * atômico RENAME→DEL) e trata a janela estendida (deadline no futuro → re-arma e
 * re-pontua o índice). Flushar duas vezes a mesma conversa nunca duplica o turno.
 *
 * **Falha isolada:** o flush de uma conversa que estoura não derruba o tick — loga
 * e segue; o membro permanece no índice e o próximo tick tenta de novo.
 *
 * `verbatimModuleSyntax` ativo → `import type` para tipos.
 */
import { getMeter } from '@hm/logger';
import { AGG_DEADLINE_PREFIX, AGG_PENDING_KEY, conversationIdFromDeadlineKey } from './buffer';
import type { BufferLogger } from './buffer';

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Lock singleton do scheduler (só 1 instância varre o índice por vez). */
export const AGG_FLUSH_LOCK_KEY = 'hm:lock:scheduler:agg-flush' as const;

/** TTL do lock: cobre um tick com folga (auto-expira se o titular travar). */
export const AGG_FLUSH_LOCK_TTL_MS = 30_000;

/**
 * Período default entre ticks. A janela de agregação é de 15-30 s; 5 s mantém a
 * latência acrescida ao caminho de recuperação irrelevante para o cliente, com
 * custo desprezível (um ZRANGEBYSCORE por tick, quase sempre vazio).
 */
export const DEFAULT_AGG_FLUSH_TICK_MS = 5_000;

/** Teto de flushes por tick (evita avalanche pós-outage; o resto vem no próximo). */
export const MAX_FLUSHES_PER_TICK = 200;

/**
 * Intervalo da reconciliação por SCAN (default 5 min). Só existe para curar
 * deadlines órfãos — os escritos antes deste fix (sem índice) ou por um produtor
 * que morra entre o ZADD e o SET. O SCAN é O(keyspace): não roda a cada tick.
 */
export const DEFAULT_AGG_RECONCILE_MS = 300_000;

/** COUNT do SCAN (fatias pequenas: não bloqueia o Redis). */
const SCAN_COUNT = 200;

/** Teto de iterações de cursor por reconciliação (proteção contra keyspace gigante). */
const MAX_SCAN_ITERATIONS = 200;

/** Script Lua de unlock (check-and-del — só o titular libera o próprio lock). */
const UNLOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * Counter OTel compartilhado por todos os schedulers (`hm.scheduler.tick`, F52-S09),
 * rotulado por `scheduler` + `result`. Um tick que FALHA vira métrica, não só log.
 */
const schedulerTickCounter = getMeter('@hm/workers').createCounter('hm.scheduler.tick', {
  description: 'Ticks de scheduler executados, por scheduler e resultado (success/failed).',
});

const SCHEDULER_NAME = 'agg-flush';

// ─── Portas ───────────────────────────────────────────────────────────────────

/**
 * Subconjunto de `ioredis` usado pelo scheduler (lock + índice + reconciliação).
 * Declarado como porta para injetar um fake no teste sem Redis real — satisfeito
 * por qualquer instância de `ioredis`.
 */
export interface AggregationSchedulerRedis {
  set(key: string, value: string, mode: 'PX', ttlMs: number, cond: 'NX'): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    limitToken: 'LIMIT',
    offset: number,
    count: number,
  ): Promise<string[]>;
  scan(
    cursor: string,
    matchToken: 'MATCH',
    pattern: string,
    countToken: 'COUNT',
    count: number,
  ): Promise<[cursor: string, keys: string[]]>;
}

/** O que o scheduler precisa do buffer: acordar o flush de uma conversa. */
export interface AggregationFlushTarget {
  flush(conversationId: string): Promise<void>;
}

/** Callback de liberação do lock de scheduler. Idempotente. */
export type ReleaseLock = () => Promise<void>;

/**
 * Adquire o lock singleton via `SET NX PX` com token aleatório. Resolve com a
 * função de liberação se vencer; `null` se outra instância já detém o lock.
 */
export async function acquireAggFlushLock(
  redis: AggregationSchedulerRedis,
  key: string = AGG_FLUSH_LOCK_KEY,
  ttlMs: number = AGG_FLUSH_LOCK_TTL_MS,
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

// ─── Reconciliação (auto-cura de deadlines órfãos) ────────────────────────────

/**
 * Varre `hm:agg:deadline:*` e reindexa no ZSET durável toda janela viva. O ZADD usa
 * o VALOR da chave de deadline (fonte de verdade); um score defasado escrito por uma
 * corrida com um enqueue concorrente é inofensivo — o `flush` revalida o deadline sob
 * lock e re-pontua o índice.
 *
 * Reindexa também o que já está no índice (ZADD é upsert): o custo é o mesmo e o
 * score converge para o valor autoritativo.
 *
 * @returns Quantas janelas foram (re)indexadas.
 */
export async function reconcileAggregationIndex(
  redis: AggregationSchedulerRedis,
  logger: BufferLogger,
): Promise<number> {
  let cursor = '0';
  let iterations = 0;
  let indexed = 0;

  do {
    const [next, keys] = await redis.scan(
      cursor,
      'MATCH',
      `${AGG_DEADLINE_PREFIX}*`,
      'COUNT',
      SCAN_COUNT,
    );
    cursor = next;
    iterations += 1;

    for (const key of keys) {
      const conversationId = conversationIdFromDeadlineKey(key);
      if (conversationId === null) continue;

      const raw = await redis.get(key);
      if (raw === null) continue; // Expirou entre o SCAN e o GET — nada a indexar.

      const deadline = Number(raw);
      if (!Number.isFinite(deadline)) continue; // Valor corrompido — ignora.

      await redis.zadd(AGG_PENDING_KEY, deadline, conversationId);
      indexed += 1;
    }

    if (iterations >= MAX_SCAN_ITERATIONS && cursor !== '0') {
      logger.warn('agg-flush: reconciliação truncada — keyspace grande', { iterations, indexed });
      break;
    }
  } while (cursor !== '0');

  if (indexed > 0) {
    logger.info('agg-flush: janelas reindexadas no índice durável', { indexed });
  }
  return indexed;
}

// ─── Tick ─────────────────────────────────────────────────────────────────────

/** Dependências do tick. */
export interface AggregationFlushDeps {
  readonly redis: AggregationSchedulerRedis;
  /** O buffer de agregação (o scheduler só o acorda — não reimplementa o flush). */
  readonly buffer: AggregationFlushTarget;
  readonly logger: BufferLogger;
}

/** Opções do tick (injetáveis p/ teste determinístico). */
export interface AggregationFlushTickOptions {
  /** Instante de referência em epoch-ms (default: `Date.now()`). */
  readonly nowMs?: number;
  /** Reconcilia o índice por SCAN antes de varrer (default: `false`). */
  readonly reconcile?: boolean;
  /** Teto de flushes neste tick (default: `MAX_FLUSHES_PER_TICK`). */
  readonly limit?: number;
}

/** Resultado observável de um tick. */
export interface AggregationFlushTickResult {
  /** `true` se esta instância venceu o lock e rodou; `false` se outra o detinha. */
  readonly ran: boolean;
  /** Conversas vencidas encontradas no índice durável. */
  readonly due: number;
  /** Conversas efetivamente flushadas (o flush pode ser no-op idempotente). */
  readonly flushed: number;
  /** Flushes que falharam (permanecem no índice para o próximo tick). */
  readonly failed: number;
  /** Janelas reindexadas pela reconciliação (0 quando ela não rodou). */
  readonly reindexed: number;
}

/**
 * Executa um tick: adquire o lock singleton, (opcionalmente) reconcilia o índice e
 * flusha toda conversa com deadline vencido. Não lança: falhas de conversa são
 * isoladas; falha de infra propaga ao caller (o scheduler loga e segue vivo).
 */
export async function runAggregationFlushTick(
  deps: AggregationFlushDeps,
  options: AggregationFlushTickOptions = {},
): Promise<AggregationFlushTickResult> {
  const { redis, buffer, logger } = deps;
  const nowMs = options.nowMs ?? Date.now();
  const limit = options.limit ?? MAX_FLUSHES_PER_TICK;

  const release = await acquireAggFlushLock(redis);
  if (release === null) {
    logger.debug('agg-flush: tick pulado — lock detido por outra instância');
    return { ran: false, due: 0, flushed: 0, failed: 0, reindexed: 0 };
  }

  try {
    const reindexed =
      options.reconcile === true ? await reconcileAggregationIndex(redis, logger) : 0;

    const due = await redis.zrangebyscore(AGG_PENDING_KEY, '-inf', nowMs, 'LIMIT', 0, limit);

    let flushed = 0;
    let failed = 0;
    for (const conversationId of due) {
      try {
        await buffer.flush(conversationId);
        flushed += 1;
      } catch (err: unknown) {
        // Uma conversa falha não derruba o tick — o membro fica no índice e o
        // próximo tick tenta de novo (o flush é idempotente).
        failed += 1;
        logger.error('agg-flush: flush de conversa falhou', {
          conversationId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (due.length > 0) {
      logger.info('agg-flush: janelas vencidas processadas', {
        due: due.length,
        flushed,
        failed,
      });
    }

    return { ran: true, due: due.length, flushed, failed, reindexed };
  } finally {
    await release();
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

/** Lê o intervalo do tick do ambiente (`AGG_FLUSH_TICK_MS`, default 5 s). */
export function aggFlushTickMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['AGG_FLUSH_TICK_MS'];
  if (raw === undefined || raw.length === 0) return DEFAULT_AGG_FLUSH_TICK_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AGG_FLUSH_TICK_MS;
}

/** Opções do scheduler. */
export interface AggregationFlushSchedulerOptions {
  readonly intervalMs?: number;
  /** Intervalo entre reconciliações por SCAN (default 5 min). */
  readonly reconcileMs?: number;
}

/** Handle do scheduler (parada limpa). */
export interface AggregationFlushSchedulerHandle {
  stop(): Promise<void>;
}

/**
 * Inicia o scheduler durável do flush de agregação. O PRIMEIRO tick já reconcilia
 * (é o boot: exatamente o momento em que existem janelas órfãs deixadas pelo
 * processo anterior); depois a reconciliação passa a ser periódica e rala, e o
 * caminho quente é só o ZRANGEBYSCORE.
 *
 * Reentrância evitada por flag (um tick lento não empilha). Erros são logados sem
 * derrubar o scheduler. `unref` para não segurar o event loop no shutdown.
 */
export function startAggregationFlushScheduler(
  deps: AggregationFlushDeps,
  options: AggregationFlushSchedulerOptions = {},
): AggregationFlushSchedulerHandle {
  const intervalMs = options.intervalMs ?? aggFlushTickMsFromEnv();
  const reconcileMs = options.reconcileMs ?? DEFAULT_AGG_RECONCILE_MS;

  let running = false;
  /** `0` força reconciliação no primeiro tick (recuperação pós-restart). */
  let lastReconcileAt = 0;

  const tick = (): void => {
    if (running) {
      deps.logger.debug('agg-flush: tick anterior ainda em execução — disparo pulado');
      return;
    }
    running = true;

    const nowMs = Date.now();
    const reconcile = nowMs - lastReconcileAt >= reconcileMs;
    if (reconcile) lastReconcileAt = nowMs;

    void runAggregationFlushTick(deps, { nowMs, reconcile })
      .then((result) => {
        if (result.ran) schedulerTickCounter.add(1, { scheduler: SCHEDULER_NAME, result: 'success' });
      })
      .catch((err: unknown) => {
        schedulerTickCounter.add(1, { scheduler: SCHEDULER_NAME, result: 'failed' });
        deps.logger.error('agg-flush: tick falhou', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();

  deps.logger.info('agg-flush scheduler iniciado', { intervalMs, reconcileMs });

  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      deps.logger.info('agg-flush scheduler parado');
      await Promise.resolve();
    },
  };
}
