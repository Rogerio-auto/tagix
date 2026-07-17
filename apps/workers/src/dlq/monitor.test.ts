import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@hm/logger';
import {
  dlqDepth,
  dlqMonitorIntervalFromEnv,
  runDlqMonitorTick,
  shouldAlertDlq,
} from './index';

const logger = createLogger('error');

type CheckQueueResult = { queue: string; messageCount: number; consumerCount: number };

function fakeChannel(
  responses: Array<number | Error>,
): { channel: Parameters<typeof dlqDepth>[0]; calls: number } {
  const state = { calls: 0 };
  const channel = {
    checkQueue: vi.fn(async (): Promise<CheckQueueResult> => {
      const next = responses[state.calls] ?? responses[responses.length - 1] ?? 0;
      state.calls += 1;
      if (next instanceof Error) throw next;
      return { queue: 'hm.q.dlq', messageCount: next, consumerCount: 0 };
    }),
  } as unknown as Parameters<typeof dlqDepth>[0];
  return {
    channel,
    get calls() {
      return state.calls;
    },
  };
}

describe('shouldAlertDlq', () => {
  it('alerta quando cresce e atinge o limiar', () => {
    expect(shouldAlertDlq(0, 1, 1)).toBe(true);
    expect(shouldAlertDlq(3, 7, 1)).toBe(true);
  });
  it('não alerta em backlog estável (sem crescimento)', () => {
    expect(shouldAlertDlq(5, 5, 1)).toBe(false);
  });
  it('não alerta quando encolhe (replay/purge)', () => {
    expect(shouldAlertDlq(9, 4, 1)).toBe(false);
  });
  it('respeita limiar acima de 1', () => {
    expect(shouldAlertDlq(0, 1, 5)).toBe(false);
    expect(shouldAlertDlq(0, 5, 5)).toBe(true);
  });
});

describe('dlqDepth', () => {
  it('lê messageCount via checkQueue (não-destrutivo)', async () => {
    const { channel } = fakeChannel([12]);
    await expect(dlqDepth(channel)).resolves.toBe(12);
  });
});

describe('runDlqMonitorTick', () => {
  it('atualiza estado e alerta ao aparecer mensagem nova', async () => {
    const { channel } = fakeChannel([2]);
    const spy = vi.spyOn(logger, 'error');
    const state = { prevDepth: 0 };
    const depth = await runDlqMonitorTick(channel, state, { logger, alertThreshold: 1 });
    expect(depth).toBe(2);
    expect(state.prevDepth).toBe(2);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('não re-alerta backlog estável entre ticks', async () => {
    const { channel } = fakeChannel([2, 2]);
    const spy = vi.spyOn(logger, 'error');
    const state = { prevDepth: 0 };
    await runDlqMonitorTick(channel, state, { logger, alertThreshold: 1 });
    await runDlqMonitorTick(channel, state, { logger, alertThreshold: 1 });
    expect(spy).toHaveBeenCalledOnce(); // só no 1º tick (0 -> 2)
    spy.mockRestore();
  });

  it('devolve null e loga quando a leitura falha (AMQP caído)', async () => {
    const { channel } = fakeChannel([new Error('channel closed')]);
    const state = { prevDepth: 3 };
    const depth = await runDlqMonitorTick(channel, state, { logger, alertThreshold: 1 });
    expect(depth).toBeNull();
    expect(state.prevDepth).toBe(3); // preservado
  });
});

describe('dlqMonitorIntervalFromEnv', () => {
  it('default 30s', () => {
    expect(dlqMonitorIntervalFromEnv({})).toBe(30_000);
  });
  it('respeita valor e cai no default se inválido', () => {
    expect(dlqMonitorIntervalFromEnv({ DLQ_MONITOR_INTERVAL_MS: '5000' })).toBe(5000);
    expect(dlqMonitorIntervalFromEnv({ DLQ_MONITOR_INTERVAL_MS: '0' })).toBe(30_000);
  });
});
