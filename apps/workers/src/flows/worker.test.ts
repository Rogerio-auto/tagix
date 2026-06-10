import { describe, expect, it, vi } from 'vitest';
import { makeEnvelope } from '@hm/shared/mq';
import { createLogger } from '@hm/logger';
import { handleFlowExecutionEnvelope, type FlowWorkerDeps } from './worker';

const logger = createLogger('error');

function deps(processFlowStepScoped = vi.fn(async () => {})): FlowWorkerDeps {
  return {
    engine: {
      triggerFlow: vi.fn(),
      processFlowStep: vi.fn(),
      processFlowStepScoped,
      resumeFlowWithResponse: vi.fn(),
      cancelFlowExecution: vi.fn(),
      cancelAllForConversation: vi.fn(),
      deps: {} as never,
    },
    logger,
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
});
