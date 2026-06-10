import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@hm/logger';
import {
  acquireSchedulerLock,
  runFlowWakeupTick,
  type DueExecution,
  type FlowSchedulerDeps,
  type RedisLike,
} from './scheduler';

const logger = createLogger('error');

function fakeRedis(setResult: 'OK' | null = 'OK'): RedisLike {
  return {
    set: vi.fn(async () => setResult),
    eval: vi.fn(async () => 1),
  };
}

function fakeChannel() {
  const published: { routingKey: string; body: unknown }[] = [];
  return {
    channel: {
      publish: vi.fn((_ex: string, routingKey: string, body: Buffer) => {
        published.push({ routingKey, body: JSON.parse(body.toString()) });
        return true;
      }),
    } as unknown as FlowSchedulerDeps['channel'],
    published,
  };
}

const WS = '11111111-1111-1111-1111-111111111111';

describe('runFlowWakeupTick', () => {
  it('re-enfileira execucoes vencidas', async () => {
    const { channel, published } = fakeChannel();
    const due: DueExecution[] = [
      { workspaceId: WS, executionId: 'a' },
      { workspaceId: WS, executionId: 'b' },
    ];
    const res = await runFlowWakeupTick({
      redis: fakeRedis(),
      channel,
      logger,
      selectDue: async () => due,
    });
    expect(res).toEqual({ ran: true, enqueued: 2 });
    expect(published).toHaveLength(2);
    expect(published[0]?.routingKey).toBe('hm.q.flow.execution.step');
  });

  it('nao enfileira quando nao ha vencidas', async () => {
    const { channel, published } = fakeChannel();
    const res = await runFlowWakeupTick({
      redis: fakeRedis(),
      channel,
      logger,
      selectDue: async () => [],
    });
    expect(res).toEqual({ ran: true, enqueued: 0 });
    expect(published).toHaveLength(0);
  });

  it('pula o tick quando o lock e detido por outra instancia', async () => {
    const { channel, published } = fakeChannel();
    const select = vi.fn(async () => []);
    const res = await runFlowWakeupTick({
      redis: fakeRedis(null),
      channel,
      logger,
      selectDue: select,
    });
    expect(res.ran).toBe(false);
    expect(select).not.toHaveBeenCalled();
    expect(published).toHaveLength(0);
  });
});

describe('acquireSchedulerLock', () => {
  it('retorna release quando ganha o lock e libera via eval', async () => {
    const redis = fakeRedis('OK');
    const release = await acquireSchedulerLock(redis, 'k', 1000);
    expect(release).toBeTypeOf('function');
    await release?.();
    expect(redis.eval).toHaveBeenCalledOnce();
  });

  it('retorna null quando outra instancia detem o lock', async () => {
    const release = await acquireSchedulerLock(fakeRedis(null), 'k', 1000);
    expect(release).toBeNull();
  });
});
