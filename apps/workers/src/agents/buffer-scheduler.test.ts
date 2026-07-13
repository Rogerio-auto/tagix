/**
 * Testes do wakeup durável do buffer de agregação (F56-S15 / INF-06).
 *
 * O teste central é o **restart simulado**: uma instância do buffer acumula o turno
 * do cliente e MORRE antes da janela vencer (o timer in-process vai embora com ela —
 * modelado ao descartar a instância e seus `FakeTimers`, que nunca mais avançam).
 * Uma instância NOVA sobe (como após um deploy) e o scheduler durável, varrendo o
 * índice no Redis, recupera e entrega o lote. Sem o índice, o turno era perdido para
 * sempre e a IA nunca respondia — o bug que este slot fecha.
 *
 * `FakeRedis` implementa o subconjunto usado pelo buffer (`RedisLike`) e pelo
 * scheduler (`AggregationSchedulerRedis`): listas, strings com `PX`/`NX`, ZSET com
 * `ZRANGEBYSCORE ... LIMIT` e `SCAN MATCH/COUNT`. Sem Redis real, sem timers reais.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AGG_PENDING_KEY,
  createAggregationBuffer,
  type AggregatedBatch,
  type BufferTimers,
  type RedisLike,
  type TimerHandle,
} from './buffer';
import {
  AGG_FLUSH_LOCK_KEY,
  acquireAggFlushLock,
  reconcileAggregationIndex,
  runAggregationFlushTick,
  startAggregationFlushScheduler,
  type AggregationFlushTarget,
  type AggregationSchedulerRedis,
} from './buffer-scheduler';

const CONV = '00000000-0000-0000-0000-0000000000c1';
const CONV_2 = '00000000-0000-0000-0000-0000000000c2';

// ─── Fake Redis (RedisLike + AggregationSchedulerRedis, in-memory) ────────────

class FakeRedis implements RedisLike, AggregationSchedulerRedis {
  private readonly lists = new Map<string, string[]>();
  private readonly strings = new Map<string, string>();
  private readonly zsets = new Map<string, Map<string, number>>();
  /** Comandos observados (asserções de lock/idempotência). */
  readonly evals: string[] = [];

  async rpush(key: string, ...values: string[]): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.push(...values);
    this.lists.set(key, list);
    return list.length;
  }
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? [];
    const end = stop === -1 ? list.length : stop + 1;
    return list.slice(start, end);
  }
  async pexpire(_key: string, _ms: number): Promise<number> {
    return 1; // TTL não simulado — os testes controlam o tempo explicitamente.
  }
  // Overloads: `SET k v PX ms` (buffer) e `SET k v PX ms NX` (lock do scheduler).
  async set(key: string, value: string, mode: 'PX', ms: number): Promise<unknown>;
  async set(
    key: string,
    value: string,
    mode: 'PX',
    ms: number,
    cond: 'NX',
  ): Promise<'OK' | null>;
  async set(
    key: string,
    value: string,
    _mode: 'PX',
    _ms: number,
    cond?: 'NX',
  ): Promise<unknown> {
    if (cond === 'NX' && this.strings.has(key)) return null;
    this.strings.set(key, value);
    return 'OK';
  }
  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.lists.delete(k)) n++;
      if (this.strings.delete(k)) n++;
    }
    return n;
  }
  async rename(source: string, destination: string): Promise<unknown> {
    const list = this.lists.get(source);
    if (list === undefined) throw new Error('ERR no such key');
    this.lists.set(destination, list);
    this.lists.delete(source);
    return 'OK';
  }
  async zadd(key: string, score: number, member: string): Promise<unknown> {
    const zset = this.zsets.get(key) ?? new Map<string, number>();
    zset.set(member, score);
    this.zsets.set(key, zset);
    return 1;
  }
  async zrem(key: string, ...members: string[]): Promise<number> {
    const zset = this.zsets.get(key);
    if (zset === undefined) return 0;
    let n = 0;
    for (const m of members) if (zset.delete(m)) n++;
    return n;
  }
  async zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    _limitToken: 'LIMIT',
    offset: number,
    count: number,
  ): Promise<string[]> {
    const zset = this.zsets.get(key);
    if (zset === undefined) return [];
    const lo = min === '-inf' ? Number.NEGATIVE_INFINITY : Number(min);
    const hi = max === '+inf' ? Number.POSITIVE_INFINITY : Number(max);
    return [...zset.entries()]
      .filter(([, score]) => score >= lo && score <= hi)
      .sort((a, b) => a[1] - b[1])
      .map(([member]) => member)
      .slice(offset, offset + count);
  }
  /** SCAN de uma tacada só (cursor sempre volta '0') — suficiente p/ o fake. */
  async scan(
    _cursor: string,
    _matchToken: 'MATCH',
    pattern: string,
    _countToken: 'COUNT',
    _count: number,
  ): Promise<[cursor: string, keys: string[]]> {
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    const keys = [...this.strings.keys()].filter((k) => k.startsWith(prefix));
    return ['0', keys];
  }
  async eval(script: string, _numKeys: number, ...args: string[]): Promise<unknown> {
    this.evals.push(script);
    // Unlock check-and-del: só o titular (token) apaga a própria chave.
    const [key, token] = args;
    if (key !== undefined && token !== undefined && this.strings.get(key) === token) {
      this.strings.delete(key);
      return 1;
    }
    return 0;
  }

  /** Inspeção do índice durável nos testes. */
  zscore(key: string, member: string): number | undefined {
    return this.zsets.get(key)?.get(member);
  }
  has(key: string): boolean {
    return this.strings.has(key) || this.lists.has(key);
  }
}

// ─── Fake timers (relógio do buffer; morrem junto com "o processo") ───────────

interface ScheduledTimer {
  readonly id: number;
  readonly fireAt: number;
  readonly fn: () => void;
  cancelled: boolean;
}

class FakeTimers implements BufferTimers {
  private clock: number;
  private seq = 0;
  private readonly scheduled: ScheduledTimer[] = [];

  constructor(startAt = 0) {
    this.clock = startAt;
  }
  now(): number {
    return this.clock;
  }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = ++this.seq;
    this.scheduled.push({ id, fireAt: this.clock + ms, fn, cancelled: false });
    return id as unknown as TimerHandle;
  }
  clearTimeout(handle: TimerHandle): void {
    const id = handle as unknown as number;
    const t = this.scheduled.find((s) => s.id === id);
    if (t) t.cancelled = true;
  }
  /** Avança o relógio SEM disparar timer algum (o processo "morreu": ninguém corre). */
  advanceWithoutFiring(ms: number): void {
    this.clock += ms;
  }
  /** Quantos timers ainda estão armados (prova que o timer in-process não flushou). */
  pending(): number {
    return this.scheduled.filter((s) => !s.cancelled).length;
  }
}

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

/** Compõe um "processo": um buffer sobre o Redis compartilhado, com relógio próprio. */
function spawnProcess(redis: FakeRedis, startAt: number) {
  const timers = new FakeTimers(startAt);
  const onFlush = vi.fn<(batch: AggregatedBatch) => Promise<void>>(async () => undefined);
  const buffer = createAggregationBuffer({ redis, onFlush, logger, timers });
  return { timers, onFlush, buffer };
}

// ─── O teste que define o slot ────────────────────────────────────────────────

describe('wakeup durável — restart do worker no meio da janela (INF-06)', () => {
  it('recupera e entrega o lote pendente numa instância NOVA (o timer original morreu)', async () => {
    const redis = new FakeRedis();

    // ── Instância 1: cliente manda 2 fragmentos; janela de 20s começa a correr.
    const p1 = spawnProcess(redis, 1_000_000);
    await p1.buffer.enqueueOrExtend(CONV, { text: 'oi' }, 20, {
      workspaceId: 'ws-1',
      trigger: { conversationId: CONV },
    });
    await p1.buffer.enqueueOrExtend(CONV, { text: 'queria saber o preço' }, 20, {
      workspaceId: 'ws-1',
      trigger: { conversationId: CONV },
    });

    // ── CRASH: o processo morre com a janela viva. O timer in-process vai junto:
    // ninguém mais o dispara (relógio avança, callbacks nunca correm).
    expect(p1.timers.pending()).toBe(1);
    p1.timers.advanceWithoutFiring(30_000); // deadline vence "durante o restart"
    expect(p1.onFlush).not.toHaveBeenCalled();

    // O conteúdo e o deadline continuam no Redis — e, crucialmente, a conversa está
    // no índice durável de janelas pendentes.
    const deadline = redis.zscore(AGG_PENDING_KEY, CONV);
    expect(deadline).toBe(1_000_000 + 20_000);

    // ── Instância 2 sobe (deploy). Nada re-arma o timer daquela janela.
    const p2 = spawnProcess(redis, 1_030_000);
    const scheduler = { redis, buffer: p2.buffer, logger };

    // O scheduler durável varre o índice e acorda o flush do que venceu.
    const result = await runAggregationFlushTick(scheduler, { nowMs: 1_030_000 });

    expect(result).toMatchObject({ ran: true, due: 1, flushed: 1, failed: 0 });
    expect(p2.onFlush).toHaveBeenCalledOnce();

    const batch = p2.onFlush.mock.calls[0]![0];
    expect(batch.conversationId).toBe(CONV);
    expect(batch.messages.map((m) => m.text)).toEqual(['oi', 'queria saber o preço']);
    expect(batch.mergedText).toBe('oi\nqueria saber o preço');
    // Contexto durável sobreviveu → o lote é ACIONÁVEL (dá para rodar o agente).
    expect(batch.context).toEqual({ workspaceId: 'ws-1', trigger: { conversationId: CONV } });

    // Janela consumida: sai do índice; um segundo tick não re-entrega (idempotência).
    expect(redis.zscore(AGG_PENDING_KEY, CONV)).toBeUndefined();
    const second = await runAggregationFlushTick(scheduler, { nowMs: 1_060_000 });
    expect(second).toMatchObject({ ran: true, due: 0, flushed: 0 });
    expect(p2.onFlush).toHaveBeenCalledOnce();
  });

  it('não flusha janela ainda viva (deadline no futuro) — o debounce continua valendo', async () => {
    const redis = new FakeRedis();
    const p = spawnProcess(redis, 0);
    await p.buffer.enqueueOrExtend(CONV, { text: 'oi' }, 30);

    const result = await runAggregationFlushTick(
      { redis, buffer: p.buffer, logger },
      { nowMs: 10_000 }, // 10s < 30s
    );

    expect(result).toMatchObject({ ran: true, due: 0, flushed: 0 });
    expect(p.onFlush).not.toHaveBeenCalled();
    expect(redis.zscore(AGG_PENDING_KEY, CONV)).toBe(30_000);
  });
});

// ─── Reconciliação (janelas escritas ANTES deste fix) ────────────────────────

describe('reconcileAggregationIndex — auto-cura de deadlines órfãos', () => {
  it('reindexa janela que só tem chave de deadline (produtor de versão anterior)', async () => {
    const redis = new FakeRedis();

    // Estado deixado por um worker PRÉ-fix: itens + deadline, mas nada no índice.
    await redis.rpush(`hm:agg:items:${CONV}`, JSON.stringify({ text: 'legado', receivedAt: 1 }));
    await redis.set(`hm:agg:deadline:${CONV}`, '5000', 'PX', 60_000);
    expect(redis.zscore(AGG_PENDING_KEY, CONV)).toBeUndefined();

    const p = spawnProcess(redis, 10_000);
    const result = await runAggregationFlushTick(
      { redis, buffer: p.buffer, logger },
      { nowMs: 10_000, reconcile: true },
    );

    expect(result).toMatchObject({ ran: true, reindexed: 1, due: 1, flushed: 1 });
    expect(p.onFlush).toHaveBeenCalledOnce();
    expect(p.onFlush.mock.calls[0]![0].messages.map((m) => m.text)).toEqual(['legado']);
  });

  it('ignora chaves de deadline corrompidas ou expiradas', async () => {
    const redis = new FakeRedis();
    await redis.set(`hm:agg:deadline:${CONV}`, 'não-é-número', 'PX', 60_000);

    const indexed = await reconcileAggregationIndex(redis, logger);

    expect(indexed).toBe(0);
    expect(redis.zscore(AGG_PENDING_KEY, CONV)).toBeUndefined();
  });
});

// ─── Singleton entre instâncias ───────────────────────────────────────────────

describe('singleton do scheduler (lock Redis)', () => {
  it('só uma instância roda o tick; a outra pula sem tocar no índice', async () => {
    const redis = new FakeRedis();
    const p = spawnProcess(redis, 0);
    await p.buffer.enqueueOrExtend(CONV, { text: 'oi' }, 5);
    // O tempo passa sem o timer in-process disparar (o wakeup agora é do scheduler).
    p.timers.advanceWithoutFiring(10_000);

    // Instância A já detém o lock (simula tick concorrente em outro processo).
    const releaseA = await acquireAggFlushLock(redis);
    expect(releaseA).not.toBeNull();

    const result = await runAggregationFlushTick(
      { redis, buffer: p.buffer, logger },
      { nowMs: 10_000 }, // deadline vencido, mas o lock é de A
    );

    expect(result).toMatchObject({ ran: false, due: 0, flushed: 0 });
    expect(p.onFlush).not.toHaveBeenCalled();

    // A libera → o próximo tick (instância B) processa normalmente.
    await releaseA?.();
    expect(redis.has(AGG_FLUSH_LOCK_KEY)).toBe(false);

    const after = await runAggregationFlushTick(
      { redis, buffer: p.buffer, logger },
      { nowMs: 10_000 },
    );
    expect(after).toMatchObject({ ran: true, flushed: 1 });
    expect(p.onFlush).toHaveBeenCalledOnce();
  });

  it('libera o lock mesmo quando o flush estoura (sem lock vazado)', async () => {
    const redis = new FakeRedis();
    const boom: AggregationFlushTarget = {
      flush: vi.fn(async () => {
        throw new Error('redis down');
      }),
    };
    await redis.zadd(AGG_PENDING_KEY, 1, CONV);
    await redis.zadd(AGG_PENDING_KEY, 2, CONV_2);

    const result = await runAggregationFlushTick(
      { redis, buffer: boom, logger },
      { nowMs: 10_000 },
    );

    // As duas conversas falharam, mas o tick sobreviveu e o lock foi liberado.
    expect(result).toMatchObject({ ran: true, due: 2, flushed: 0, failed: 2 });
    expect(redis.has(AGG_FLUSH_LOCK_KEY)).toBe(false);
    // Membros permanecem no índice → o próximo tick tenta de novo (nada se perde).
    expect(redis.zscore(AGG_PENDING_KEY, CONV)).toBe(1);
    expect(redis.zscore(AGG_PENDING_KEY, CONV_2)).toBe(2);
  });
});

// ─── Scheduler (loop) ─────────────────────────────────────────────────────────

describe('startAggregationFlushScheduler', () => {
  it('reconcilia e flusha no primeiro tick; para limpo', async () => {
    vi.useFakeTimers();
    try {
      const redis = new FakeRedis();
      // Estado órfão pré-fix (sem índice): só a reconciliação do boot o recupera.
      await redis.rpush(
        `hm:agg:items:${CONV}`,
        JSON.stringify({ text: 'perdido no deploy', receivedAt: 1 }),
      );
      await redis.set(`hm:agg:deadline:${CONV}`, String(Date.now() - 1), 'PX', 60_000);

      // O buffer da instância nova nasce com o relógio no "agora" (deadline vencido).
      const p = spawnProcess(redis, Date.now());
      const handle = startAggregationFlushScheduler(
        { redis, buffer: p.buffer, logger },
        { intervalMs: 1_000 },
      );

      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(() => expect(p.onFlush).toHaveBeenCalledOnce());

      expect(p.onFlush.mock.calls[0]![0].messages.map((m) => m.text)).toEqual([
        'perdido no deploy',
      ]);

      await handle.stop();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(p.onFlush).toHaveBeenCalledOnce(); // parado de verdade.
    } finally {
      vi.useRealTimers();
    }
  });
});
