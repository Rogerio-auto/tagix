import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@hm/logger';
import { isOptOutKeyword, OPT_OUT_KEYWORDS } from './optout';
import {
  processCampaignInbound,
  type CampaignInboundPorts,
  type InboundMessage,
  type RecentDelivery,
} from './processor';

function makeLogger(): Logger {
  const l = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { ...l, child: () => l } as unknown as Logger;
}

const MSG: InboundMessage = {
  workspaceId: 'ws1',
  channelId: 'ch1',
  contactId: 'c1',
  conversationId: 'conv1',
  text: 'ola tudo bem',
};

function makePorts(over: Partial<CampaignInboundPorts> = {}): CampaignInboundPorts {
  return {
    optOutContact: vi.fn(async () => undefined),
    findRecentDelivery: vi.fn(async (): Promise<RecentDelivery | null> => null),
    markRecipientResponded: vi.fn(async () => undefined),
    handoffToAgent: vi.fn(async () => ({ applied: true })),
    ...over,
  };
}

const delivery: RecentDelivery = {
  deliveryId: 'd1',
  campaignId: 'camp1',
  recipientId: 'r1',
  autoHandoffOnReply: false,
  aiHandoffAgentId: null,
  hasOnReplyFollowup: false,
};

describe('isOptOutKeyword (MATCH EXATO — anti-falso-positivo)', () => {
  it('aceita cada keyword exata (com trim/upper)', () => {
    for (const kw of OPT_OUT_KEYWORDS) {
      expect(isOptOutKeyword(kw)).toBe(true);
      expect(isOptOutKeyword('  ' + kw.toLowerCase() + '  ')).toBe(true);
    }
  });
  it('NAO opta out texto que apenas CONTEM a palavra', () => {
    expect(isOptOutKeyword('quero PARAR de receber as 18h')).toBe(false);
    expect(isOptOutKeyword('pode CANCELAR meu pedido?')).toBe(false);
    expect(isOptOutKeyword('vou SAIR mais tarde')).toBe(false);
    expect(isOptOutKeyword('parar' + ' agora')).toBe(false);
  });
  it('vazio/null/undefined -> false', () => {
    expect(isOptOutKeyword('')).toBe(false);
    expect(isOptOutKeyword(null)).toBe(false);
    expect(isOptOutKeyword(undefined)).toBe(false);
  });
});

describe('processCampaignInbound', () => {
  it('keyword exata -> opta out + confirma + para (precedencia sobre reply)', async () => {
    const ports = makePorts({ findRecentDelivery: vi.fn(async () => delivery) });
    const out = await processCampaignInbound({ ...MSG, text: 'PARAR' }, { ports, logger: makeLogger() });
    expect(out.kind).toBe('opted_out');
    // F70-S25: opt-out e confirmacao numa porta so (uma transacao).
    expect(ports.optOutContact).toHaveBeenCalledWith({ ...MSG, text: 'PARAR' }, 'KEYWORD_STOP');
    expect(ports.optOutContact).toHaveBeenCalledOnce();
    // opt-out tem precedencia: NAO trata como reply.
    expect(ports.markRecipientResponded).not.toHaveBeenCalled();
  });

  it('texto que so contem PARAR NAO opta out -> cai no reply handling', async () => {
    const ports = makePorts({ findRecentDelivery: vi.fn(async () => delivery) });
    const out = await processCampaignInbound(
      { ...MSG, text: 'quero PARAR de receber' },
      { ports, logger: makeLogger() },
    );
    expect(ports.optOutContact).not.toHaveBeenCalled();
    expect(out.kind).toBe('reply_handled');
    expect(ports.markRecipientResponded).toHaveBeenCalledWith('ws1', 'r1', null);
  });

  it('sem delivery recente -> no_op', async () => {
    const ports = makePorts();
    const out = await processCampaignInbound(MSG, { ports, logger: makeLogger() });
    expect(out.kind).toBe('no_op');
    expect(ports.markRecipientResponded).not.toHaveBeenCalled();
  });

  it('reply com auto_handoff + agente -> faz handoff', async () => {
    const ports = makePorts({
      findRecentDelivery: vi.fn(async () => ({
        ...delivery,
        autoHandoffOnReply: true,
        aiHandoffAgentId: 'agent1',
      })),
    });
    const out = await processCampaignInbound(MSG, { ports, logger: makeLogger() });
    expect(out.kind).toBe('reply_handled');
    if (out.kind === 'reply_handled') expect(out.handedOff).toBe(true);
    expect(ports.handoffToAgent).toHaveBeenCalledWith(MSG, 'agent1');
  });

  it('F70-S13: trava de origem recusa -> handedOff false (IA continua desligada)', async () => {
    const ports = makePorts({
      findRecentDelivery: vi.fn(async () => ({
        ...delivery,
        autoHandoffOnReply: true,
        aiHandoffAgentId: 'agent1',
        hasOnReplyFollowup: true,
      })),
      handoffToAgent: vi.fn(async () => ({ applied: false })),
    });
    const logger = makeLogger();
    const out = await processCampaignInbound(MSG, { ports, logger });
    expect(out).toEqual({ kind: 'reply_handled', campaignId: 'camp1', handedOff: false });
    expect(ports.handoffToAgent).toHaveBeenCalledWith(MSG, 'agent1');
    // A recusa nao interrompe o resto do reply: responded + followup seguem.
    expect(ports.markRecipientResponded).toHaveBeenCalledWith('ws1', 'r1', {
      campaignId: 'camp1',
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ handedOff: false }),
    );
  });

  it('reply sem agente -> NAO faz handoff', async () => {
    const ports = makePorts({
      findRecentDelivery: vi.fn(async () => ({ ...delivery, autoHandoffOnReply: true, aiHandoffAgentId: null })),
    });
    const out = await processCampaignInbound(MSG, { ports, logger: makeLogger() });
    if (out.kind === 'reply_handled') expect(out.handedOff).toBe(false);
    expect(ports.handoffToAgent).not.toHaveBeenCalled();
  });

  it('reply com followup on_reply -> grava o followup junto da marca de resposta', async () => {
    const ports = makePorts({
      findRecentDelivery: vi.fn(async () => ({ ...delivery, hasOnReplyFollowup: true })),
    });
    await processCampaignInbound(MSG, { ports, logger: makeLogger() });
    expect(ports.markRecipientResponded).toHaveBeenCalledWith('ws1', 'r1', { campaignId: 'camp1' });
  });

  it('reply SEM followup on_reply -> so a marca de resposta', async () => {
    const ports = makePorts({ findRecentDelivery: vi.fn(async () => delivery) });
    await processCampaignInbound(MSG, { ports, logger: makeLogger() });
    expect(ports.markRecipientResponded).toHaveBeenCalledWith('ws1', 'r1', null);
  });
});
