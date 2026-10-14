import { describe, expect, it, vi } from 'vitest';
import type { Channel, IChannelAdapter, SendResult } from '@hm/channels';
import type { Logger } from '@hm/logger';
import { parseOutboundJob } from './job';
import { runPresencePreAction } from './presence';

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child() {
    return this;
  },
};

function channel(provider: Channel['provider']): Channel {
  return { id: 'ch1', workspaceId: 'ws1', provider, accessToken: 'token', phoneNumberId: 'pn1' };
}

function adapter(provider: Channel['provider']): IChannelAdapter {
  const ok: SendResult = { ok: true, externalId: 'external' };
  return {
    provider,
    capabilities: {
      templatesHSM: false,
      storyMentions: false,
      storyReplies: false,
      publicComments: false,
      messageTags: false,
      voicePtt: true,
      sticker: true,
      location: true,
    },
    parseInbound: vi.fn(async () => []),
    sendText: vi.fn(async () => ok),
    sendMedia: vi.fn(async () => ok),
    sendTemplate: vi.fn(async () => ok),
    sendInteractive: vi.fn(async () => ok),
    downloadMedia: vi.fn(async () => Buffer.alloc(0)),
    markAsRead: vi.fn(async () => undefined),
    sendTypingIndicator: vi.fn(async () => undefined),
  };
}

const job = parseOutboundJob({
  kind: 'text',
  channelId: 'ch1',
  conversationId: 'cv1',
  messageId: 'm1',
  chatId: '5511999999999',
  text: 'oi',
});

describe('runPresencePreAction', () => {
  it('nao usa chatId como message_id no WhatsApp Cloud API', async () => {
    const wa = adapter('meta_whatsapp');
    expect(await runPresencePreAction(job, channel('meta_whatsapp'), wa, logger)).toBe(false);
    expect(wa.sendTypingIndicator).not.toHaveBeenCalled();
  });

  it('mantem o pre-action nos providers cujo adapter aceita chatId', async () => {
    const waha = adapter('waha');
    expect(await runPresencePreAction(job, channel('waha'), waha, logger)).toBe(true);
    expect(waha.sendTypingIndicator).toHaveBeenCalledWith(
      '5511999999999',
      'typing',
      channel('waha'),
    );
  });
});
