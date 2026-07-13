/**
 * Buffer de agregação de mensagens inbound (F2-S12, AGENTS_LANGGRAPH §10).
 *
 * Clientes mandam mensagens fragmentadas ("oi", "tudo bem?", "queria saber…")
 * em sequência rápida. Disparar o agente a cada fragmento custa caro e quebra a
 * coerência da resposta. Este buffer agrupa as inbound da MESMA conversa numa
 * janela (`window_sec`, vinda da policy do agente — `agents.aggregation_window_sec`)
 * e só então entrega o LOTE ordenado ao runner (F2-S11) via `onFlush`.
 *
 * Arquitetura (multi-instância segura):
 *
 * ```
 * enqueueOrExtend(conversationId, message, windowSec, context?)
 *   → ZADD   hm:agg:pending  score=deadline  member=conv   (ÍNDICE DURÁVEL — 1º)
 *   → RPUSH  hm:agg:items:{conv}  (mantém ORDEM de chegada) + PEXPIRE (TTL de guarda)
 *   → SET    hm:agg:ctx:{conv} = contexto do turno (JSON opaco p/ o buffer)
 *   → SET    hm:agg:deadline:{conv} = now + window  (marca quando deve flushar)
 *   → (re)arma um timer in-process p/ ~windowSec  (debounce: cada msg estende)
 *
 * timer expira (ou o scheduler durável acorda) → flush(conversationId)
 *   → runWithDistributedLock(hm:lock:agg:{conv})      (1 flusher por vez/instância)
 *       → se há deadline futuro (outra msg chegou): re-arma, re-pontua o índice e
 *         NÃO flusha ainda
 *       → drainItems (rename atômico + LRANGE + DEL)  (cada item sai UMA vez)
 *       → ZREM hm:agg:pending                          (sai do índice durável)
 *       → onFlush(batch ordenado + contexto)          ← entrega ao runner
 * ```
 *
 * **Wakeup durável (F56-S15 / INF-06).** O timer in-process é apenas o caminho
 * RÁPIDO (baixa latência no caso feliz). Ele **não** é a fonte de verdade: um
 * restart do worker no meio da janela mataria o timer e a IA nunca responderia
 * àquele turno. Por isso todo enqueue publica o deadline num **índice durável**
 * no Redis — o ZSET `hm:agg:pending` (score = epoch-ms do deadline) — varrido por
 * `buffer-scheduler.ts` (singleton via lock Redis), que chama `flush` de tudo que
 * venceu. O ZADD acontece ANTES do RPUSH: o índice é sempre um **superconjunto**
 * dos buffers vivos (crash entre as duas escritas deixa um membro órfão que o
 * flush seguinte drena como no-op e remove — auto-cura, nunca perda).
 *
 * **Contexto durável.** O lote só é acionável após um restart se o gatilho do turno
 * (workspace/contato/canal) sobreviver junto. O buffer não interpreta o contexto:
 * guarda o JSON que o produtor passar (`hm:agg:ctx:{conv}`) e o devolve em
 * `AggregatedBatch.context` — quem consome (o worker de agentes) valida com Zod.
 *
 * **Redis** é a fonte de verdade do conteúdo + da ordem + do deadline + do TTL; o
 * **lock** (o mesmo `LockStore` de `lock.ts`, FIFO em memória por default, pronto
 * p/ backend Redis em multi-instância) serializa o flush; o **drain atômico**
 * (RENAME → DEL) garante flush idempotente: dois flushers concorrentes para a mesma
 * janela só podem drenar uma vez — o segundo encontra a lista vazia e vira no-op.
 *
 * O `RedisLike` é um subconjunto injetável de `ioredis` (RPUSH/PEXPIRE/SET/GET/
 * RENAME/LRANGE/DEL/ZADD/ZREM) — os testes passam um fake; produção passa o cliente
 * real.
 *
 * `verbatimModuleSyntax` ativo → `import type` para tipos.
 */
import { runWithDistributedLock, type LockStore } from '../lock';

// ─── Shapes públicos ──────────────────────────────────────────────────────────

/**
 * Uma mensagem inbound agregável. Mínimo necessário para reconstruir o turno: o
 * texto + correlação opcional (`externalId` do provider, p/ casar com o gatilho
 * de F1-S26) + timestamp de chegada (ordenação determinística no lote).
 */
export interface BufferedMessage {
  /** Texto da mensagem inbound (já normalizado pelo inbound pipeline). */
  readonly text: string;
  /** `externalId` do provider, quando presente — casa com `triggerExternalId`. */
  readonly externalId?: string;
  /** Epoch ms de chegada. Default: `Date.now()` no enqueue. */
  readonly receivedAt?: number;
}

/**
 * Lote entregue ao `onFlush` quando a janela de uma conversa expira. As mensagens
 * vêm na ORDEM de chegada (a ordem em que o cliente as enviou).
 */
export interface AggregatedBatch {
  readonly conversationId: string;
  readonly messages: readonly BufferedMessage[];
  /** Texto concatenado (1 mensagem por linha) — atalho p/ o `userInput` do runner. */
  readonly mergedText: string;
  /**
   * Contexto durável do turno, exatamente como o produtor o passou no
   * `enqueueOrExtend` (`hm:agg:ctx:{conv}`). `undefined` quando não houve contexto
   * (ou quando ele expirou/corrompeu). Opaco para o buffer — o consumidor valida.
   * É o que permite reconstruir o gatilho do agente após um restart do processo.
   */
  readonly context?: AggregationContext;
}

/**
 * Contexto do turno, serializável em JSON. O buffer o persiste e o devolve tal e
 * qual: nenhuma chave é interpretada aqui (o worker de agentes valida com Zod).
 */
export type AggregationContext = Record<string, unknown>;

/** Handler chamado UMA vez por janela expirada, com o lote ordenado da conversa. */
export type OnFlush = (batch: AggregatedBatch) => Promise<void>;

/**
 * Subconjunto de `ioredis` usado pelo buffer. Permite injetar um fake nos testes
 * (sem Redis real) e o cliente `ioredis` real em produção sem `any`.
 */
export interface RedisLike {
  rpush(key: string, ...values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  pexpire(key: string, ms: number): Promise<number>;
  set(key: string, value: string, mode: 'PX', ms: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  /** RENAME que NÃO lança quando a origem não existe (RENAMENX-like no-op aqui). */
  rename(source: string, destination: string): Promise<unknown>;
  /** Índice durável de deadlines: ZADD `hm:agg:pending` score=deadline member=conv. */
  zadd(key: string, score: number, member: string): Promise<unknown>;
  /** Remove a conversa do índice durável quando a janela é consumida. */
  zrem(key: string, ...members: string[]): Promise<number>;
}

/** Logger mínimo (compatível com `@hm/logger`). */
export interface BufferLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** Dependências do buffer de agregação. */
export interface AggregationBufferDeps {
  readonly redis: RedisLike;
  /** Entrega o lote ao runner (o worker liga isto a `runAgent`). */
  readonly onFlush: OnFlush;
  readonly logger: BufferLogger;
  /**
   * Backend de lock do flush (default: FIFO em memória de `lock.ts`). Em
   * multi-instância, injete um `LockStore` Redis para serializar entre processos.
   */
  readonly lockStore?: LockStore;
  /** Override de timers/relógio (testes com fake timers). Default: globais. */
  readonly timers?: BufferTimers;
}

/** Abstração de relógio/timers — injetável p/ testes determinísticos. */
export interface BufferTimers {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

/** Handle opaco de timer (Node `Timeout` ou número, conforme o ambiente). */
export type TimerHandle = ReturnType<typeof setTimeout>;

/** API pública do buffer. */
export interface AggregationBuffer {
  /**
   * Acumula `message` na conversa e (re)arma a janela de `windowSec` segundos.
   * Cada chamada ESTENDE a janela (debounce): o flush só ocorre `windowSec` após
   * a ÚLTIMA mensagem. Retorna ao terminar de gravar/armar (não espera o flush).
   *
   * `context` (opcional) é gravado de forma DURÁVEL e devolvido no lote — é como
   * o consumidor reconstrói o gatilho depois de um restart. A última chamada da
   * janela vence (o turno mais recente descreve melhor o gatilho).
   */
  enqueueOrExtend(
    conversationId: string,
    message: BufferedMessage,
    windowSec: number,
    context?: AggregationContext,
  ): Promise<void>;
  /**
   * Força o flush imediato de uma conversa (drena + entrega se houver lote).
   * Idempotente — flush concorrente/duplo não re-entrega. Útil em shutdown e é o
   * ponto de entrada do scheduler durável (`buffer-scheduler.ts`).
   */
  flush(conversationId: string): Promise<void>;
  /** Cancela todos os timers pendentes (shutdown limpo). NÃO drena o Redis. */
  stop(): void;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const ITEMS_PREFIX = 'hm:agg:items:';
const DRAIN_PREFIX = 'hm:agg:drain:';
const CTX_PREFIX = 'hm:agg:ctx:';
const LOCK_PREFIX = 'hm:lock:agg:';

/**
 * Prefixo das chaves de deadline. Exportado: o scheduler durável reconcilia
 * deadlines órfãos (escritos por uma versão anterior, sem índice) varrendo-as.
 */
export const AGG_DEADLINE_PREFIX = 'hm:agg:deadline:';

/**
 * ZSET do índice durável de janelas pendentes: `member` = conversationId,
 * `score` = epoch-ms do deadline. Fonte de verdade do wakeup (sobrevive a restart).
 */
export const AGG_PENDING_KEY = 'hm:agg:pending';

/** Extrai o `conversationId` de uma chave `hm:agg:deadline:{conv}` (`null` se não casar). */
export function conversationIdFromDeadlineKey(key: string): string | null {
  if (!key.startsWith(AGG_DEADLINE_PREFIX)) return null;
  const id = key.slice(AGG_DEADLINE_PREFIX.length);
  return id.length > 0 ? id : null;
}

/**
 * Folga somada ao TTL das chaves de conteúdo acima da janela. Cobre o atraso
 * entre a expiração do timer e o drain efetivo sob lock — a lista não pode
 * expirar antes de ser drenada, mas também não deve vazar p/ sempre se o processo
 * morrer antes do flush.
 */
const ITEMS_TTL_GRACE_MS = 60_000;

/** Teto de posse do lock de flush (proteção contra flusher travado). */
const FLUSH_LOCK_TTL_MS = 30_000;

const DEFAULT_TIMERS: BufferTimers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const h = setTimeout(fn, ms);
    h.unref?.();
    return h;
  },
  clearTimeout: (h) => clearTimeout(h),
};

function itemsKey(conversationId: string): string {
  return `${ITEMS_PREFIX}${conversationId}`;
}
function drainKey(conversationId: string): string {
  return `${DRAIN_PREFIX}${conversationId}`;
}
function deadlineKey(conversationId: string): string {
  return `${AGG_DEADLINE_PREFIX}${conversationId}`;
}
function ctxKey(conversationId: string): string {
  return `${CTX_PREFIX}${conversationId}`;
}
function lockKey(conversationId: string): string {
  return `${LOCK_PREFIX}${conversationId}`;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Cria um buffer de agregação. As dependências (Redis, `onFlush`, lock, timers)
 * são injetadas — nenhuma é construída aqui, mantendo o buffer testável sem
 * Redis real nem RabbitMQ.
 */
export function createAggregationBuffer(deps: AggregationBufferDeps): AggregationBuffer {
  const { redis, onFlush, logger } = deps;
  const lockStore = deps.lockStore;
  const timers = deps.timers ?? DEFAULT_TIMERS;

  /** Timers de janela in-process, por conversa (debounce). */
  const windowTimers = new Map<string, TimerHandle>();

  function clearWindowTimer(conversationId: string): void {
    const handle = windowTimers.get(conversationId);
    if (handle !== undefined) {
      timers.clearTimeout(handle);
      windowTimers.delete(conversationId);
    }
  }

  /** (Re)arma o timer in-process para disparar o flush em `delayMs`. */
  function armWindowTimer(conversationId: string, delayMs: number): void {
    clearWindowTimer(conversationId);
    const handle = timers.setTimeout(() => {
      windowTimers.delete(conversationId);
      void flush(conversationId).catch((err: unknown) => {
        logger.error('agg-buffer: flush falhou no timer', {
          conversationId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, Math.max(0, delayMs));
    windowTimers.set(conversationId, handle);
  }

  async function enqueueOrExtend(
    conversationId: string,
    message: BufferedMessage,
    windowSec: number,
    context?: AggregationContext,
  ): Promise<void> {
    const windowMs = Math.max(0, Math.round(windowSec * 1000));
    const ttlMs = windowMs + ITEMS_TTL_GRACE_MS;
    const receivedAt = message.receivedAt ?? timers.now();
    const stored: BufferedMessage = {
      text: message.text,
      ...(message.externalId !== undefined ? { externalId: message.externalId } : {}),
      receivedAt,
    };
    const deadline = timers.now() + windowMs;

    // (1) ÍNDICE DURÁVEL PRIMEIRO. Se o processo morrer entre este ZADD e o RPUSH,
    // o scheduler acorda um membro sem itens → flush drena vazio e remove o membro
    // (no-op auto-curável). A ordem inversa perderia o turno: itens no Redis sem
    // ninguém agendado para flushá-los — exatamente o INF-06.
    await redis.zadd(AGG_PENDING_KEY, deadline, conversationId);

    const items = itemsKey(conversationId);
    await redis.rpush(items, JSON.stringify(stored));
    // TTL de guarda: cobre a janela + folga; renovado a cada mensagem.
    await redis.pexpire(items, ttlMs);

    // Contexto durável do turno (opcional): o que permite reconstruir o gatilho
    // do agente num flush pós-restart. Última mensagem da janela vence.
    if (context !== undefined) {
      await redis.set(ctxKey(conversationId), JSON.stringify(context), 'PX', ttlMs);
    }

    // Marca o instante-alvo do flush (fonte cross-instância: se outra instância
    // recebeu uma msg mais nova, o deadline avança e o flush local re-arma).
    await redis.set(deadlineKey(conversationId), String(deadline), 'PX', ttlMs);

    armWindowTimer(conversationId, windowMs);

    logger.debug('agg-buffer: mensagem acumulada', {
      conversationId,
      windowMs,
      hasExternalId: message.externalId !== undefined,
      hasContext: context !== undefined,
    });
  }

  /** Lê o contexto durável do turno. `undefined` se ausente/corrompido/expirado. */
  async function readContext(conversationId: string): Promise<AggregationContext | undefined> {
    const raw = await redis.get(ctxKey(conversationId));
    if (raw === null) return undefined;
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as AggregationContext;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Drena os itens da conversa de forma ATÔMICA: move a lista para uma chave de
   * drain exclusiva (RENAME), lê e apaga. Dois flushers concorrentes não podem
   * drenar a mesma lista — o RENAME só sucede para um; o outro vê origem ausente
   * e retorna `[]`. Garante que cada mensagem é entregue UMA vez.
   */
  async function drainItems(conversationId: string): Promise<BufferedMessage[]> {
    const items = itemsKey(conversationId);
    const drain = drainKey(conversationId);

    try {
      await redis.rename(items, drain);
    } catch {
      // Origem inexistente (já drenada / nunca existiu) → nada a entregar.
      return [];
    }

    const raw = await redis.lrange(drain, 0, -1);
    await redis.del(drain);

    const messages: BufferedMessage[] = [];
    for (const entry of raw) {
      const parsed = safeParse(entry);
      if (parsed !== null) messages.push(parsed);
    }
    // Ordena por chegada (RPUSH já preserva a ordem; o sort é defesa em
    // profundidade caso instâncias concorrentes intercalem com clocks distintos).
    messages.sort((a, b) => (a.receivedAt ?? 0) - (b.receivedAt ?? 0));
    return messages;
  }

  async function flush(conversationId: string): Promise<void> {
    await runWithDistributedLock(
      lockKey(conversationId),
      FLUSH_LOCK_TTL_MS,
      async () => {
        // Janela ainda viva? Outra mensagem chegou e empurrou o deadline p/ frente
        // → re-arma e adia (não flush parcial). Cross-instância via `deadlineKey`.
        const deadlineRaw = await redis.get(deadlineKey(conversationId));
        if (deadlineRaw !== null) {
          const deadline = Number(deadlineRaw);
          const remaining = deadline - timers.now();
          if (Number.isFinite(remaining) && remaining > 0) {
            armWindowTimer(conversationId, remaining);
            // Re-pontua o índice durável: o deadline (fonte de verdade) mandou.
            // Cobre o caso em que o scheduler acordou cedo por um score defasado —
            // sem isto, ele reflusharia em loop até a janela vencer.
            await redis.zadd(AGG_PENDING_KEY, deadline, conversationId);
            logger.debug('agg-buffer: janela estendida — flush adiado', {
              conversationId,
              remainingMs: remaining,
            });
            return;
          }
        }

        const context = await readContext(conversationId);
        const messages = await drainItems(conversationId);
        // Limpa deadline + contexto já consumidos e retira a conversa do índice
        // durável (best-effort; os TTLs cuidariam de qualquer modo). O ZREM vem
        // DEPOIS do drain: se o processo morrer no meio, o membro sobrevive e o
        // próximo tick reflusha — no pior caso um no-op, nunca um turno perdido.
        await redis.del(deadlineKey(conversationId), ctxKey(conversationId));
        await redis.zrem(AGG_PENDING_KEY, conversationId);

        if (messages.length === 0) {
          // Já drenado por outro flusher (idempotência) ou janela vazia → no-op.
          logger.debug('agg-buffer: flush sem itens — no-op', { conversationId });
          return;
        }

        const batch: AggregatedBatch = {
          conversationId,
          messages,
          mergedText: messages.map((m) => m.text).join('\n'),
          ...(context !== undefined ? { context } : {}),
        };

        logger.info('agg-buffer: flush do lote', {
          conversationId,
          count: messages.length,
          hasContext: context !== undefined,
        });
        await onFlush(batch);
      },
      lockStore,
    );
  }

  function stop(): void {
    for (const handle of windowTimers.values()) timers.clearTimeout(handle);
    windowTimers.clear();
  }

  return { enqueueOrExtend, flush, stop };
}

/** Parse defensivo de um item: descarta entradas corrompidas sem derrubar o lote. */
function safeParse(entry: string): BufferedMessage | null {
  try {
    const value: unknown = JSON.parse(entry);
    if (
      typeof value === 'object' &&
      value !== null &&
      'text' in value &&
      typeof (value as { text: unknown }).text === 'string'
    ) {
      return value as BufferedMessage;
    }
    return null;
  } catch {
    return null;
  }
}
