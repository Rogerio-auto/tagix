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
 * enqueueOrExtend(conversationId, message, windowSec)
 *   → RPUSH hm:agg:items:{conv}  (mantém ORDEM de chegada) + PEXPIRE (TTL de guarda)
 *   → SET    hm:agg:deadline:{conv} = now + window  (marca quando deve flushar)
 *   → (re)arma um timer in-process p/ ~windowSec  (debounce: cada msg estende)
 *
 * timer expira → flush(conversationId)
 *   → runWithDistributedLock(hm:lock:agg:{conv})      (1 flusher por vez/instância)
 *       → drainItems (rename atômico + LRANGE + DEL)  (cada item sai UMA vez)
 *       → se houve deadline futuro (outra msg chegou): re-arma e NÃO flusha ainda
 *       → senão: onFlush(batch ordenado)  ← entrega ao runner
 * ```
 *
 * **Redis** é a fonte de verdade do conteúdo + da ordem + do TTL; o **lock** (o
 * mesmo `LockStore` de `lock.ts`, FIFO em memória por default, pronto p/ backend
 * Redis em multi-instância) serializa o flush; o **drain atômico** (RENAME → DEL)
 * garante flush idempotente: dois flushers concorrentes para a mesma janela só
 * podem drenar uma vez — o segundo encontra a lista vazia e vira no-op.
 *
 * O `RedisLike` é um subconjunto injetável de `ioredis` (RPUSH/PEXPIRE/SET/GET/
 * RENAME/LRANGE/DEL) — os testes passam um fake; produção passa o cliente real.
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
}

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
   */
  enqueueOrExtend(
    conversationId: string,
    message: BufferedMessage,
    windowSec: number,
  ): Promise<void>;
  /**
   * Força o flush imediato de uma conversa (drena + entrega se houver lote).
   * Idempotente — flush concorrente/duplo não re-entrega. Útil em shutdown.
   */
  flush(conversationId: string): Promise<void>;
  /** Cancela todos os timers pendentes (shutdown limpo). NÃO drena o Redis. */
  stop(): void;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const ITEMS_PREFIX = 'hm:agg:items:';
const DRAIN_PREFIX = 'hm:agg:drain:';
const DEADLINE_PREFIX = 'hm:agg:deadline:';
const LOCK_PREFIX = 'hm:lock:agg:';

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
  return `${DEADLINE_PREFIX}${conversationId}`;
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
  ): Promise<void> {
    const windowMs = Math.max(0, Math.round(windowSec * 1000));
    const receivedAt = message.receivedAt ?? timers.now();
    const stored: BufferedMessage = {
      text: message.text,
      ...(message.externalId !== undefined ? { externalId: message.externalId } : {}),
      receivedAt,
    };

    const items = itemsKey(conversationId);
    await redis.rpush(items, JSON.stringify(stored));
    // TTL de guarda: cobre a janela + folga; renovado a cada mensagem.
    await redis.pexpire(items, windowMs + ITEMS_TTL_GRACE_MS);

    // Marca o instante-alvo do flush (fonte cross-instância: se outra instância
    // recebeu uma msg mais nova, o deadline avança e o flush local re-arma).
    const deadline = timers.now() + windowMs;
    await redis.set(deadlineKey(conversationId), String(deadline), 'PX', windowMs + ITEMS_TTL_GRACE_MS);

    armWindowTimer(conversationId, windowMs);

    logger.debug('agg-buffer: mensagem acumulada', {
      conversationId,
      windowMs,
      hasExternalId: message.externalId !== undefined,
    });
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
          const remaining = Number(deadlineRaw) - timers.now();
          if (Number.isFinite(remaining) && remaining > 0) {
            armWindowTimer(conversationId, remaining);
            logger.debug('agg-buffer: janela estendida — flush adiado', {
              conversationId,
              remainingMs: remaining,
            });
            return;
          }
        }

        const messages = await drainItems(conversationId);
        // Limpa o deadline já consumido (best-effort; TTL cuidaria de qualquer modo).
        await redis.del(deadlineKey(conversationId));

        if (messages.length === 0) {
          // Já drenado por outro flusher (idempotência) ou janela vazia → no-op.
          logger.debug('agg-buffer: flush sem itens — no-op', { conversationId });
          return;
        }

        const batch: AggregatedBatch = {
          conversationId,
          messages,
          mergedText: messages.map((m) => m.text).join('\n'),
        };

        logger.info('agg-buffer: flush do lote', {
          conversationId,
          count: messages.length,
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
