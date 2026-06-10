/**
 * Testes do buffer de agregação (F2-S12).
 *
 * Sem Redis real: um `FakeRedis` in-memory implementa o subconjunto `RedisLike`
 * (RPUSH/LRANGE/PEXPIRE/SET/GET/RENAME/DEL). Os timers são controlados por um
 * `FakeTimers` injetado (relógio + fila de callbacks) — `tick(ms)` avança o
 * tempo e dispara os timers vencidos de forma determinística. O `onFlush` é um
 * spy `vi.fn`.
 *
 * Cobre: batching dentro da janela (uma só entrega), idempotência do flush
 * (flush concorrente/duplo não re-entrega), e extensão da janela (cada mensagem
 * adia o flush).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAggregationBuffer,
  type AggregatedBatch,
  type BufferTimers,
  type RedisLike,
  type TimerHandle,
} from './buffer';

const CONV = '00000000-0000-0000-0000-0000000000c1';

// ─── Fake Redis (subconjunto RedisLike, in-memory) ────────────────────────────

class FakeRedis implements RedisLike {
  private readonly lists = new Map<string, string[]>();
  private readonly strings = new Map<string, string>();

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
    return 1; // TTL não simulado (testes controlam o tempo via timers).
  }
  async set(key: string, value: string, _mode: 'PX', _ms: number): Promise<unknown> {
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
}

// ─── Fake timers (relógio + fila determinística) ──────────────────────────────

interface ScheduledTimer {
  readonly id: number;
  readonly fireAt: number;
  readonly fn: () => void;
  cancelled: boolean;
}

class FakeTimers implements BufferTimers {
  private clock = 0;
  private seq = 0;
  private readonly scheduled: ScheduledTimer[] = [];

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
  /** Avança o relógio `ms` e dispara (em ordem) os timers vencidos não cancelados. */
  async tick(ms: number): Promise<void> {
    this.clock += ms;
    // Itera até estabilizar (um flush pode re-armar um timer). Entre rodadas,
    // cede a um macrotask REAL (`setImmediate`) p/ drenar toda a cadeia de awaits
    // do flush (lock + Redis fake), não só duas microtasks.
    for (;;) {
      const due = this.scheduled
        .filter((s) => !s.cancelled && s.fireAt <= this.clock)
        .sort((a, b) => a.fireAt - b.fireAt);
      if (due.length === 0) break;
      for (const t of due) {
        t.cancelled = true;
        t.fn();
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function setup() {
  const redis = new FakeRedis();
  const timers = new FakeTimers();
  const onFlush = vi.fn<(batch: AggregatedBatch) => Promise<void>>(async () => undefined);
  const buffer = createAggregationBuffer({ redis, onFlush, logger, timers });
  return { redis, timers, onFlush, buffer };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createAggregationBuffer — batching dentro da janela', () => {
  it('agrupa várias mensagens da mesma conversa num único flush ordenado', async () => {
    const { timers, onFlush, buffer } = setup();

    await buffer.enqueueOrExtend(CONV, { text: 'oi' }, 20);
    await buffer.enqueueOrExtend(CONV, { text: 'tudo bem?' }, 20);
    await buffer.enqueueOrExtend(CONV, { text: 'queria saber o preço' }, 20);

    // Antes da janela expirar: nada foi entregue.
    await timers.tick(19_000);
    expect(onFlush).not.toHaveBeenCalled();

    // Janela expira (20s após a ÚLTIMA mensagem) → um único flush com o lote.
    await timers.tick(1_000);
    expect(onFlush).toHaveBeenCalledOnce();

    const batch = onFlush.mock.calls[0]![0];
    expect(batch.conversationId).toBe(CONV);
    expect(batch.messages.map((m) => m.text)).toEqual(['oi', 'tudo bem?', 'queria saber o preço']);
    expect(batch.mergedText).toBe('oi\ntudo bem?\nqueria saber o preço');
  });
});

describe('createAggregationBuffer — extensão da janela (debounce)', () => {
  it('cada mensagem adia o flush; só dispara após o silêncio de window_sec', async () => {
    const { timers, onFlush, buffer } = setup();

    await buffer.enqueueOrExtend(CONV, { text: 'a' }, 10);
    await timers.tick(8_000); // 8s — janela ainda viva
    expect(onFlush).not.toHaveBeenCalled();

    await buffer.enqueueOrExtend(CONV, { text: 'b' }, 10); // estende: deadline = +10s daqui
    await timers.tick(8_000); // total 16s, mas só 8s desde 'b'
    expect(onFlush).not.toHaveBeenCalled();

    await timers.tick(2_000); // 10s desde 'b' → flush
    expect(onFlush).toHaveBeenCalledOnce();
    expect((onFlush.mock.calls[0]![0]).messages.map((m) => m.text)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('createAggregationBuffer — idempotência do flush', () => {
  it('flush manual duplo (concorrente) entrega o lote uma única vez', async () => {
    const { onFlush, buffer } = setup();

    await buffer.enqueueOrExtend(CONV, { text: 'x' }, 20);
    await buffer.enqueueOrExtend(CONV, { text: 'y' }, 20);

    // Força o tempo a passar do deadline via flush manual: dois flushes em paralelo.
    // (sem timers: o deadline ainda é futuro, então simulamos shutdown forçado)
    await Promise.all([buffer.flush(CONV), buffer.flush(CONV)]);

    // O deadline ainda é futuro nos dois → ambos re-armam, nenhum entrega.
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('após o flush real, um flush adicional é no-op (lista já drenada)', async () => {
    const { timers, onFlush, buffer } = setup();

    await buffer.enqueueOrExtend(CONV, { text: 'única' }, 5);
    await timers.tick(5_000);
    expect(onFlush).toHaveBeenCalledOnce();

    // Flush manual extra após a entrega: nada para drenar → continua 1 só entrega.
    await buffer.flush(CONV);
    expect(onFlush).toHaveBeenCalledOnce();
  });

  it('preserva externalId no lote', async () => {
    const { timers, onFlush, buffer } = setup();
    await buffer.enqueueOrExtend(CONV, { text: 'oi', externalId: 'wamid.123' }, 5);
    await timers.tick(5_000);
    const batch = onFlush.mock.calls[0]![0];
    expect(batch.messages[0]?.externalId).toBe('wamid.123');
  });
});

describe('createAggregationBuffer — stop()', () => {
  it('cancela timers pendentes (sem flush após stop)', async () => {
    const { timers, onFlush, buffer } = setup();
    await buffer.enqueueOrExtend(CONV, { text: 'oi' }, 10);
    buffer.stop();
    await timers.tick(10_000);
    expect(onFlush).not.toHaveBeenCalled();
  });
});
