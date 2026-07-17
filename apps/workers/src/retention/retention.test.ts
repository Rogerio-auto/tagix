/**
 * F56-S25 (DB-02) — worker de retenção de `webhook_events`.
 *
 * Testes puros com dados sintéticos e uma porta em memória que espelha a
 * semântica do DELETE real (apaga até `limit` linhas mais antigas abaixo do
 * corte). Cobrem: respeito ao horizonte, batelamento, idempotência, teto por
 * tick, corte, config por env e o lock singleton via Redis.
 *
 * Sem infra: a porta é injetável, então a suíte não depende de DB — o motor do
 * sweep é validado deterministicamente.
 */
import { describe, expect, it } from 'vitest';
import { createLogger } from '@hm/logger';
import {
  computeCutoff,
  parsePositiveInt,
  resolveRetentionConfig,
  runRetentionSweepOnce,
  runSweep,
  acquireSweepLock,
} from './index';
import type { RedisLike, RetentionConfig, RetentionSweepPort } from './index';

const logger = createLogger('error');

interface Row {
  id: string;
  receivedAt: Date;
}

/** Porta em memória: mesma semântica do DELETE batelado real. */
class FakeSweepPort implements RetentionSweepPort {
  calls = 0;
  constructor(private rows: Row[]) {}

  async deleteOlderThan(cutoff: Date, limit: number): Promise<number> {
    this.calls += 1;
    const eligible = this.rows
      .filter((r) => r.receivedAt.getTime() < cutoff.getTime())
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
      .slice(0, limit);
    const doomed = new Set(eligible.map((r) => r.id));
    this.rows = this.rows.filter((r) => !doomed.has(r.id));
    return eligible.length;
  }

  get remaining(): number {
    return this.rows.length;
  }
  hasId(id: string): boolean {
    return this.rows.some((r) => r.id === id);
  }
}

function daysAgo(base: Date, days: number): Date {
  return new Date(base.getTime() - days * 24 * 60 * 60 * 1_000);
}

function mkRows(base: Date): Row[] {
  return [
    { id: 'old-60d', receivedAt: daysAgo(base, 60) },
    { id: 'old-45d', receivedAt: daysAgo(base, 45) },
    { id: 'old-31d', receivedAt: daysAgo(base, 31) },
    { id: 'edge-beyond', receivedAt: daysAgo(base, 30.5) }, // 30.5d > 30d → purgar
    { id: 'edge-within', receivedAt: daysAgo(base, 29.5) }, // 29.5d < 30d → preservar
    { id: 'fresh-1d', receivedAt: daysAgo(base, 1) },
    { id: 'now', receivedAt: base },
  ];
}

describe('computeCutoff', () => {
  it('subtrai o horizonte do instante atual', () => {
    const now = new Date('2026-07-17T00:00:00.000Z');
    const cutoff = computeCutoff(now, 30 * 24 * 60 * 60 * 1_000);
    expect(cutoff.toISOString()).toBe('2026-06-17T00:00:00.000Z');
  });
});

describe('parsePositiveInt', () => {
  it('usa fallback para ausente/vazio/inválido/não-positivo', () => {
    expect(parsePositiveInt(undefined, 30)).toBe(30);
    expect(parsePositiveInt('', 30)).toBe(30);
    expect(parsePositiveInt('   ', 30)).toBe(30);
    expect(parsePositiveInt('abc', 30)).toBe(30);
    expect(parsePositiveInt('0', 30)).toBe(30);
    expect(parsePositiveInt('-5', 30)).toBe(30);
    expect(parsePositiveInt('7', 30)).toBe(7);
  });
});

describe('resolveRetentionConfig', () => {
  it('defaults seguros quando o env não define nada', () => {
    const cfg = resolveRetentionConfig({});
    expect(cfg.horizonMs).toBe(30 * 24 * 60 * 60 * 1_000);
    expect(cfg.batchSize).toBe(1_000);
    expect(cfg.maxBatchesPerTick).toBe(50);
    expect(cfg.intervalMs).toBe(24 * 60 * 60 * 1_000);
  });

  it('respeita overrides de env válidos', () => {
    const cfg = resolveRetentionConfig({
      WEBHOOK_EVENTS_RETENTION_DAYS: '7',
      RETENTION_SWEEP_BATCH_SIZE: '250',
      RETENTION_SWEEP_MAX_BATCHES: '4',
    });
    expect(cfg.horizonMs).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(cfg.batchSize).toBe(250);
    expect(cfg.maxBatchesPerTick).toBe(4);
  });
});

describe('runSweep', () => {
  const base = new Date('2026-07-17T12:00:00.000Z');
  const horizonMs = 30 * 24 * 60 * 60 * 1_000;
  const cutoff = computeCutoff(base, horizonMs);

  it('remove apenas o que está abaixo do horizonte, preservando o resto', async () => {
    const port = new FakeSweepPort(mkRows(base));
    const result = await runSweep(port, { cutoff, batchSize: 100, maxBatches: 100 });

    expect(result.deleted).toBe(4); // 60d, 45d, 31d, 30.5d (beyond horizonte)
    expect(result.reachedCap).toBe(false);
    // Fronteira: 30.5d (além) purgado; 29.5d (dentro) preservado.
    expect(port.hasId('edge-beyond')).toBe(false);
    expect(port.hasId('edge-within')).toBe(true);
    expect(port.hasId('fresh-1d')).toBe(true);
    expect(port.hasId('now')).toBe(true);
    expect(port.hasId('old-60d')).toBe(false);
  });

  it('bateladas: com batchSize=1 faz um DELETE por linha elegível + 1 lote parcial', async () => {
    const port = new FakeSweepPort(mkRows(base));
    const result = await runSweep(port, { cutoff, batchSize: 1, maxBatches: 100 });

    expect(result.deleted).toBe(4);
    // 4 lotes cheios (retornam 1 == batchSize) → o 5º volta 0 e encerra.
    expect(result.batches).toBe(4);
    expect(port.calls).toBe(5);
  });

  it('é idempotente: segunda passada não remove nada', async () => {
    const port = new FakeSweepPort(mkRows(base));
    const first = await runSweep(port, { cutoff, batchSize: 100, maxBatches: 100 });
    expect(first.deleted).toBe(4);

    const second = await runSweep(port, { cutoff, batchSize: 100, maxBatches: 100 });
    expect(second.deleted).toBe(0);
    expect(second.batches).toBe(0);
  });

  it('teto por tick: para em maxBatches e sinaliza backlog (reachedCap)', async () => {
    const rows: Row[] = Array.from({ length: 10 }, (_, i) => ({
      id: `r-${i}`,
      receivedAt: daysAgo(base, 40 + i),
    }));
    const port = new FakeSweepPort(rows);
    const result = await runSweep(port, { cutoff, batchSize: 2, maxBatches: 2 });

    expect(result.deleted).toBe(4); // 2 lotes * 2
    expect(result.batches).toBe(2);
    expect(result.reachedCap).toBe(true);
    expect(port.remaining).toBe(6);
  });

  it('nada abaixo do horizonte: 0 lotes, não chama a porta em loop', async () => {
    const port = new FakeSweepPort([{ id: 'now', receivedAt: base }]);
    const result = await runSweep(port, { cutoff, batchSize: 100, maxBatches: 100 });
    expect(result.deleted).toBe(0);
    expect(result.batches).toBe(0);
    expect(port.calls).toBe(1);
  });
});

/** Redis fake para o lock singleton: SET NX real por chave. */
class FakeRedis implements RedisLike {
  private store = new Map<string, string>();
  async set(key: string, value: string, _mode: 'PX', _ttl: number, _cond: 'NX') {
    if (this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK' as const;
  }
  async eval(_script: string, _numKeys: number, key: string, value: string) {
    if (this.store.get(key) === value) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }
}

const testConfig: RetentionConfig = {
  horizonMs: 30 * 24 * 60 * 60 * 1_000,
  batchSize: 100,
  maxBatchesPerTick: 100,
  intervalMs: 1_000,
  initialDelayMs: 1_000,
};

describe('runRetentionSweepOnce (lock singleton)', () => {
  const base = new Date('2026-07-17T12:00:00.000Z');
  const now = (): Date => base;

  it('varre sob o lock e o libera ao final (permite re-adquirir)', async () => {
    const redis = new FakeRedis();
    const port = new FakeSweepPort(mkRows(base));
    const result = await runRetentionSweepOnce({ redis, logger, port, config: testConfig, now });
    expect(result?.deleted).toBe(4);

    // Lock foi liberado → um segundo tick roda (idempotente: 0).
    const again = await runRetentionSweepOnce({ redis, logger, port, config: testConfig, now });
    expect(again?.deleted).toBe(0);
  });

  it('não varre se outra instância detém o lock (retorna null, porta intacta)', async () => {
    const redis = new FakeRedis();
    // Instância concorrente segura o lock e NÃO libera.
    const held = await acquireSweepLock(redis, 'hm:lock:scheduler:retention-sweep', 60_000);
    expect(held).not.toBeNull();

    const port = new FakeSweepPort(mkRows(base));
    const result = await runRetentionSweepOnce({ redis, logger, port, config: testConfig, now });
    expect(result).toBeNull();
    expect(port.calls).toBe(0);
    expect(port.remaining).toBe(mkRows(base).length);
  });
});
