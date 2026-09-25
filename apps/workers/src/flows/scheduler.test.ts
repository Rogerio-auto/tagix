import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@hm/logger';
import {
  acquireSchedulerLock,
  DEFAULT_FLOW_RUNNING_MAX_AGE_MS,
  DEFAULT_FLOW_RUNNING_STALE_MS,
  MIN_FLOW_RUNNING_STALE_MS,
  runFlowWakeupTick,
  runningRecoveryFromEnv,
  type DueExecution,
  type FlowSchedulerDeps,
  type RecoverRunningPort,
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

// F70-S25: a recuperacao de running parada tem teste proprio contra o banco.
const noRecovery: RecoverRunningPort = async () => ({ recovered: [], expired: [] });

describe('runFlowWakeupTick', () => {
  it('re-enfileira execucoes vencidas', async () => {
    const { channel, published } = fakeChannel();
    const due: DueExecution[] = [
      { workspaceId: WS, executionId: 'a' },
      { workspaceId: WS, executionId: 'b' },
    ];
    const res = await runFlowWakeupTick({
      recoverRunning: noRecovery,
      redis: fakeRedis(),
      channel,
      logger,
      selectDue: async () => due,
    });
    expect(res).toEqual({ ran: true, enqueued: 2, recovered: 0, expired: 0 });
    expect(published).toHaveLength(2);
    expect(published[0]?.routingKey).toBe('hm.q.flow.execution.step');
  });

  it('nao enfileira quando nao ha vencidas', async () => {
    const { channel, published } = fakeChannel();
    const res = await runFlowWakeupTick({
      recoverRunning: noRecovery,
      redis: fakeRedis(),
      channel,
      logger,
      selectDue: async () => [],
    });
    expect(res).toEqual({ ran: true, enqueued: 0, recovered: 0, expired: 0 });
    expect(published).toHaveLength(0);
  });

  it('pula o tick quando o lock e detido por outra instancia', async () => {
    const { channel, published } = fakeChannel();
    const select = vi.fn(async () => []);
    const res = await runFlowWakeupTick({
      recoverRunning: noRecovery,
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

describe('recuperacao de running parada no tick (F70-S25)', () => {
  it('o tick chama a recuperacao com os limites e devolve as contagens', async () => {
    const { channel } = fakeChannel();
    const recover = vi.fn<RecoverRunningPort>(async () => ({
      recovered: [{ workspaceId: WS, executionId: 'r1' }],
      expired: [{ workspaceId: WS, executionId: 'x1' }],
    }));
    const config = { staleAfterMs: 120_000, maxAgeMs: 3_600_000 };
    const res = await runFlowWakeupTick({
      redis: fakeRedis(),
      channel,
      logger,
      selectDue: async () => [],
      recoverRunning: recover,
      runningRecovery: config,
    });
    expect(res).toEqual({ ran: true, enqueued: 0, recovered: 1, expired: 1 });
    expect(recover).toHaveBeenCalledWith(config, 200);
  });

  it('sem o lock, nao recupera nada', async () => {
    const { channel } = fakeChannel();
    const recover = vi.fn<RecoverRunningPort>(async () => ({ recovered: [], expired: [] }));
    await runFlowWakeupTick({ redis: fakeRedis(null), channel, logger, recoverRunning: recover });
    expect(recover).not.toHaveBeenCalled();
  });
});

describe('runningRecoveryFromEnv (F70-S25)', () => {
  it('defaults: 5 min parada, 24 h de idade maxima', () => {
    expect(runningRecoveryFromEnv({})).toEqual({
      staleAfterMs: DEFAULT_FLOW_RUNNING_STALE_MS,
      maxAgeMs: DEFAULT_FLOW_RUNNING_MAX_AGE_MS,
    });
  });

  it('le o env; limite de parada tem piso de 1 min; idade maxima nunca abaixo dele', () => {
    expect(
      runningRecoveryFromEnv({ FLOW_RUNNING_STALE_MS: '600000', FLOW_RUNNING_MAX_AGE_MS: '7200000' }),
    ).toEqual({ staleAfterMs: 600_000, maxAgeMs: 7_200_000 });
    expect(runningRecoveryFromEnv({ FLOW_RUNNING_STALE_MS: '1000' }).staleAfterMs).toBe(
      MIN_FLOW_RUNNING_STALE_MS,
    );
    expect(
      runningRecoveryFromEnv({ FLOW_RUNNING_STALE_MS: '600000', FLOW_RUNNING_MAX_AGE_MS: '1000' }),
    ).toEqual({ staleAfterMs: 600_000, maxAgeMs: 600_000 });
    expect(runningRecoveryFromEnv({ FLOW_RUNNING_STALE_MS: 'abc' }).staleAfterMs).toBe(
      DEFAULT_FLOW_RUNNING_STALE_MS,
    );
  });
});
