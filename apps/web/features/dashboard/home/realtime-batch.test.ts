import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryKey } from '@tanstack/react-query';
import { REALTIME_BATCH_MS, createInvalidationBatch, trailingThrottle } from './realtime-batch';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('trailingThrottle', () => {
  it('uma rajada vira uma execução só, no fim da janela', () => {
    const fn = vi.fn();
    const t = trailingThrottle(fn, 3_000);
    for (let i = 0; i < 50; i++) {
      t.call();
      vi.advanceTimersByTime(20);
    }
    // 50 × 20 ms = 1 s dentro da janela: nada ainda.
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('eventos depois da janela abrem outra (o último estado sempre chega)', () => {
    const fn = vi.fn();
    const t = trailingThrottle(fn, 3_000);
    t.call();
    vi.advanceTimersByTime(3_000);
    t.call();
    t.call();
    vi.advanceTimersByTime(3_000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rajada contínua: no máximo uma execução a cada janela', () => {
    const fn = vi.fn();
    const t = trailingThrottle(fn, 3_000);
    // 10 s com um evento a cada 100 ms (100 eventos).
    for (let i = 0; i < 100; i++) {
      t.call();
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(3_000);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(4);
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('cancel descarta a execução pendente (desmontagem)', () => {
    const fn = vi.fn();
    const t = trailingThrottle(fn, 3_000);
    t.call();
    t.cancel();
    vi.advanceTimersByTime(10_000);
    expect(fn).not.toHaveBeenCalled();
    t.call();
    vi.advanceTimersByTime(3_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('createInvalidationBatch', () => {
  it('invalida /home e /today uma vez por janela de 3 s', () => {
    const invalidated: QueryKey[] = [];
    const qc = {
      invalidateQueries: vi.fn(({ queryKey }: { queryKey: QueryKey }) => {
        invalidated.push(queryKey);
        return Promise.resolve();
      }),
    };
    const batch = createInvalidationBatch(qc, [['home'], ['today']]);
    expect(REALTIME_BATCH_MS).toBe(3_000);

    for (let i = 0; i < 30; i++) batch.call();
    vi.advanceTimersByTime(REALTIME_BATCH_MS - 1);
    expect(qc.invalidateQueries).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(invalidated).toEqual([['home'], ['today']]);
  });
});
