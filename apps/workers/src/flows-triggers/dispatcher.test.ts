import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@hm/logger';
import {
  dispatchTriggersForNewMessage,
  dispatchTriggersForStageChange,
  dispatchTriggersForTagAdded,
  evaluateTrigger,
  matchesStageChange,
  matchesTagAdded,
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


describe('stage_change triggers (F5-S16)', () => {
  const info = {
    workspaceId: WS,
    dealId: 'd1',
    contactId: 'ct1',
    conversationId: 'c1',
    fromStageId: 's1',
    toStageId: 's2',
  };

  it('matchesStageChange: vazio casa qualquer; filtros casam from/to', () => {
    const f = flow({ triggerType: 'stage_change', triggerConfig: {} });
    expect(matchesStageChange(f, info)).toBe(true);
    expect(
      matchesStageChange(flow({ triggerType: 'stage_change', triggerConfig: { to_stage_id: 's2' } }), info),
    ).toBe(true);
    expect(
      matchesStageChange(flow({ triggerType: 'stage_change', triggerConfig: { to_stage_id: 'sX' } }), info),
    ).toBe(false);
    expect(
      matchesStageChange(flow({ triggerType: 'stage_change', triggerConfig: { from_stage_id: 's9' } }), info),
    ).toBe(false);
  });

  it('dispara flows stage_change que casam', async () => {
    const d = deps([flow({ triggerType: 'stage_change', triggerConfig: { to_stage_id: 's2' } })]);
    const n = await dispatchTriggersForStageChange(d, info);
    expect(n).toBe(1);
    expect(d.triggerFlow).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'ct1', triggerData: expect.objectContaining({ toStageId: 's2' }) }),
    );
  });

  it('no-match nao dispara', async () => {
    const d = deps([flow({ triggerType: 'stage_change', triggerConfig: { to_stage_id: 'sX' } })]);
    expect(await dispatchTriggersForStageChange(d, info)).toBe(0);
    expect(d.triggerFlow).not.toHaveBeenCalled();
  });
});

describe('tag_added triggers (F5-S16)', () => {
  const info = { workspaceId: WS, contactId: 'ct1', conversationId: 'c1', tagId: 'tag-1' };

  it('matchesTagAdded: vazio casa; tag_id filtra', () => {
    expect(matchesTagAdded(flow({ triggerType: 'tag_added', triggerConfig: {} }), info)).toBe(true);
    expect(matchesTagAdded(flow({ triggerType: 'tag_added', triggerConfig: { tag_id: 'tag-1' } }), info)).toBe(true);
    expect(matchesTagAdded(flow({ triggerType: 'tag_added', triggerConfig: { tag_id: 'tag-9' } }), info)).toBe(false);
  });

  it('dispara flows tag_added que casam', async () => {
    const d = deps([flow({ triggerType: 'tag_added', triggerConfig: { tag_id: 'tag-1' } })]);
    const n = await dispatchTriggersForTagAdded(d, info);
    expect(n).toBe(1);
    expect(d.triggerFlow).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'ct1', triggerData: { tagId: 'tag-1' } }),
    );
  });
});
