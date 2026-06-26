import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@hm/logger';
import type { FlowExecutionEvent } from '@hm/flow-engine';
import { createFlowEventsPublisher, type RelayEnvelopePayload } from './execution-events-publisher';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const baseEvent: FlowExecutionEvent = {
  workspaceId: 'ws-1',
  executionId: 'ex-1',
  flowId: 'flow-1',
  conversationId: 'conv-1',
  status: 'waiting',
  nextStepAt: new Date('2026-06-10T00:05:00.000Z'),
};

describe('createFlowEventsPublisher', () => {
  it('publica flow_execution:updated com target e nextStepAt ISO', async () => {
    const sent: { ws: string; payload: RelayEnvelopePayload }[] = [];
    const pub = createFlowEventsPublisher({
      logger,
      send: (ws, payload) => void sent.push({ ws, payload }),
    });
    await pub.executionChanged(baseEvent);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.ws).toBe('ws-1');
    expect(sent[0]!.payload).toMatchObject({
      event: 'flow_execution:updated',
      target: { conversationId: 'conv-1', workspace: true },
      data: {
        conversationId: 'conv-1',
        flowId: 'flow-1',
        executionId: 'ex-1',
        status: 'waiting',
        nextStepAt: '2026-06-10T00:05:00.000Z',
      },
    });
  });

  it('nextStepAt null vira null no payload', async () => {
    const sent: RelayEnvelopePayload[] = [];
    const pub = createFlowEventsPublisher({
      logger,
      send: (_ws, p) => void sent.push(p),
    });
    await pub.executionChanged({ ...baseEvent, status: 'completed', nextStepAt: null });
    expect(sent[0]!.data.nextStepAt).toBeNull();
    expect(sent[0]!.data.status).toBe('completed');
  });

  it('conversationId null omite o target de conversa (cai na room ws)', async () => {
    const sent: RelayEnvelopePayload[] = [];
    const pub = createFlowEventsPublisher({ logger, send: (_ws, p) => void sent.push(p) });
    await pub.executionChanged({ ...baseEvent, conversationId: null, nextStepAt: null });
    expect(sent[0]!.target.conversationId).toBeUndefined();
    expect(sent[0]!.target.workspace).toBe(true);
    expect(sent[0]!.data.conversationId).toBeNull();
  });

  it('best-effort: falha no send NÃO propaga (loga warn)', async () => {
    const pub = createFlowEventsPublisher({
      logger,
      send: () => {
        throw new Error('mq down');
      },
    });
    await expect(pub.executionChanged(baseEvent)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
