import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryKey } from '@tanstack/react-query';
import { REALTIME_BATCH_MS } from './home/realtime-batch';
import { createMetricChangedListener } from './metric-changed-listener';

const ME: QueryKey = ['dashboard', 'me'];

function fakeQc(): { invalidateQueries: ReturnType<typeof vi.fn> } {
  return { invalidateQueries: vi.fn(() => Promise.resolve()) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createMetricChangedListener', () => {
  it('rajada de métricas visíveis vira UMA invalidação no fim da janela de 3 s', () => {
    const qc = fakeQc();
    const l = createMetricChangedListener(qc, ME, new Set(['volume_inbound_24h']));
    for (let i = 0; i < 40; i++) {
      l.onChanged({ metricKey: 'volume_inbound_24h' });
      vi.advanceTimersByTime(25);
    }
    expect(qc.invalidateQueries).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REALTIME_BATCH_MS);
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ME });
  });

  it('métrica fora do painel renderizado não agenda nada', () => {
    const qc = fakeQc();
    const l = createMetricChangedListener(qc, ME, new Set(['volume_inbound_24h']));
    for (let i = 0; i < 10; i++) l.onChanged({ metricKey: 'custo_llm_hoje_usd' });
    vi.advanceTimersByTime(REALTIME_BATCH_MS * 3);
    expect(qc.invalidateQueries).not.toHaveBeenCalled();
  });

  it('cancel (desmontagem) descarta a invalidação pendente', () => {
    const qc = fakeQc();
    const l = createMetricChangedListener(qc, ME, new Set(['a']));
    l.onChanged({ metricKey: 'a' });
    l.cancel();
    vi.advanceTimersByTime(REALTIME_BATCH_MS * 3);
    expect(qc.invalidateQueries).not.toHaveBeenCalled();
  });

  it('fluxo contínuo: no máximo uma invalidação por janela', () => {
    const qc = fakeQc();
    const l = createMetricChangedListener(qc, ME, new Set(['a']));
    // 9 s, um evento a cada 100 ms.
    for (let i = 0; i < 90; i++) {
      l.onChanged({ metricKey: 'a' });
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(REALTIME_BATCH_MS);
    expect(qc.invalidateQueries.mock.calls.length).toBeLessThanOrEqual(4);
    expect(qc.invalidateQueries.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
