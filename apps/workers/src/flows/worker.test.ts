import { describe, expect, it, vi } from 'vitest';
import { makeEnvelope } from '@hm/shared/mq';
import { createLogger } from '@hm/logger';
import { handleFlowExecutionEnvelope, type FlowWorkerDeps } from './worker';
import type { SubscriptionGate } from '../lib/subscription-gate';

const logger = createLogger('error');

function deps(
  processFlowStepScoped = vi.fn(async () => {}),
  subscription: SubscriptionGate = {
    check: vi.fn(async () => ({ active: true as const, status: 'active' })),
  },
  cancelFlowExecution = vi.fn(async () => {}),
): FlowWorkerDeps {
  return {
    engine: {
      triggerFlow: vi.fn(),
      processFlowStep: vi.fn(),
      processFlowStepScoped,
      resumeFlowWithResponse: vi.fn(),
      cancelFlowExecution,
      cancelAllForConversation: vi.fn(),
      deps: {} as never,
    },
    logger,
    subscription,
  };
}

const WS = '11111111-1111-1111-1111-111111111111';
const EX = '22222222-2222-2222-2222-222222222222';

describe('handleFlowExecutionEnvelope', () => {
  it('chama processFlowStepScoped com workspace+execution', async () => {
    const spy = vi.fn(async () => {});
    const env = makeEnvelope('flow.execution.step', WS, { workspaceId: WS, executionId: EX });
    await handleFlowExecutionEnvelope(env, deps(spy));
    expect(spy).toHaveBeenCalledWith(WS, EX);
  });

  it('payload invalido e descartado sem chamar a engine', async () => {
    const spy = vi.fn(async () => {});
    const env = makeEnvelope('flow.execution.step', WS, { nope: true });
    await handleFlowExecutionEnvelope(env, deps(spy));
    expect(spy).not.toHaveBeenCalled();
  });

  it('falha transitoria da engine propaga (nack->DLX)', async () => {
    const spy = vi.fn(async () => {
      throw new Error('db down');
    });
    const env = makeEnvelope('flow.execution.step', WS, { workspaceId: WS, executionId: EX });
    await expect(handleFlowExecutionEnvelope(env, deps(spy))).rejects.toThrow('db down');
  });

  it('F71-S06: assinatura inativa → nao roda o step, encerra a execucao e nao lanca (sem retry)', async () => {
    const spy = vi.fn(async () => {});
    const cancel = vi.fn(async () => {});
    const gate: SubscriptionGate = {
      check: vi.fn(async () => ({ active: false as const, status: 'expired' })),
    };
    const env = makeEnvelope('flow.execution.step', WS, { workspaceId: WS, executionId: EX });
    await expect(handleFlowExecutionEnvelope(env, deps(spy, gate, cancel))).resolves.toBeUndefined();
    expect(gate.check).toHaveBeenCalledWith(WS);
    expect(spy).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith(WS, EX, 'skipped_subscription_inactive');
  });
});
