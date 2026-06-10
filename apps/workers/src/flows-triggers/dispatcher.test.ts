import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@hm/logger';
import {
  dispatchDeferredTrigger,
  dispatchTriggersForNewMessage,
  evaluateTrigger,
} from './dispatcher';
import type { ActiveFlow, InboundMessageInfo, TriggerDispatchDeps } from './index';

const logger = createLogger('error');
const WS = 'ws-1';

function msg(over: Partial<InboundMessageInfo> = {}): InboundMessageInfo {
  return {
    workspaceId: WS,
    conversationId: 'c1',
    contactId: 'ct1',
    channelId: 'ch1',
    content: 'quero COMPRAR',
    type: 'text',
    fromContact: true,
    ...over,
  };
}

function flow(over: Partial<ActiveFlow> = {}): ActiveFlow {
  return {
    id: 'f1',
    workspaceId: WS,
    triggerType: 'keyword',
    triggerConfig: { keyword: 'comprar' },
    channelIds: null,
    ...over,
  };
}

function deps(flows: ActiveFlow[]): TriggerDispatchDeps & {
  triggerFlow: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
} {
  const triggerFlow = vi.fn(async () => ({ executionId: 'e1' }));
  const resume = vi.fn(async () => {});
  return {
    flowsQuery: { findActiveByTriggerTypes: vi.fn(async () => flows) },
    engine: { triggerFlow, resumeFlowWithResponse: resume },
    logger,
    triggerFlow,
    resume,
  };
}

describe('evaluateTrigger', () => {
  it('keyword casa case-insensitive', () => {
    expect(evaluateTrigger(flow(), msg())).toBe(true);
    expect(evaluateTrigger(flow(), msg({ content: 'ola' }))).toBe(false);
  });

  it('new_message respeita message_types', () => {
    const f = flow({
      triggerType: 'new_message',
      triggerConfig: { message_types: ['interactive'] },
    });
    expect(evaluateTrigger(f, msg({ type: 'text' }))).toBe(false);
    expect(evaluateTrigger(f, msg({ type: 'interactive' }))).toBe(true);
  });

  it('filtra por channelIds', () => {
    const f = flow({ channelIds: ['outro'] });
    expect(evaluateTrigger(f, msg())).toBe(false);
  });
});

describe('dispatchTriggersForNewMessage', () => {
  it('dispara flow que casa e retoma waiting', async () => {
    const d = deps([flow()]);
    const r = await dispatchTriggersForNewMessage(d, msg());
    expect(r.triggered).toBe(1);
    expect(r.resumed).toBe(true);
    expect(d.triggerFlow).toHaveBeenCalledOnce();
    expect(d.resume).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c1', responseType: 'response' }),
    );
  });

  it('no-match nao dispara mas ainda tenta resume', async () => {
    const d = deps([flow({ triggerConfig: { keyword: 'outra' } })]);
    const r = await dispatchTriggersForNewMessage(d, msg());
    expect(r.triggered).toBe(0);
    expect(d.resume).toHaveBeenCalledOnce();
  });

  it('mensagem que nao e do contato e ignorada', async () => {
    const d = deps([flow()]);
    const r = await dispatchTriggersForNewMessage(d, msg({ fromContact: false }));
    expect(r).toEqual({ triggered: 0, resumed: false });
    expect(d.triggerFlow).not.toHaveBeenCalled();
    expect(d.resume).not.toHaveBeenCalled();
  });
});

describe('dispatchDeferredTrigger', () => {
  it('loga e nao quebra (stage_change/tag_added)', () => {
    const log = createLogger('error');
    const spy = vi.spyOn(log, 'info');
    dispatchDeferredTrigger(log, 'stage_change', { dealId: 'd1' });
    expect(spy).toHaveBeenCalled();
  });
});
