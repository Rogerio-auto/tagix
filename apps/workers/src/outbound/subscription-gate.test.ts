/**
 * F71 (F-02) — portão de assinatura no worker de outbound.
 *
 * Empresa `expired`/`canceled`/trial vencido NÃO envia ao provider: a mensagem vira
 * `failed` (motivo `skipped_subscription_inactive`) pelo caminho de falha permanente,
 * sem retry. Empresa ativa envia; `typing_indicator` (presença) não é bloqueado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, IChannelAdapter, SendResult } from '@hm/channels';
import type { Envelope } from '@hm/shared/mq';
import { handleOutboundEnvelope } from './worker';
import type { OutboundDeps } from './ports';
import { allowAllConsentGate } from './consent-gate';
import {
  createSubscriptionGate,
  SKIPPED_SUBSCRIPTION_INACTIVE,
  type WorkspaceSubscriptionRow,
} from '../lib/subscription-gate';

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(function (this: unknown) {
    return logger;
  }),
};

function setup() {
  const ok: SendResult = { ok: true, externalId: 'wamid.X' };
  const sendText = vi.fn(async () => ok);
  const typing = vi.fn(async () => undefined);
  const adapter: IChannelAdapter = {
    provider: 'meta_whatsapp',
    capabilities: {
      templatesHSM: true,
      storyMentions: false,
      storyReplies: false,
      publicComments: false,
      messageTags: false,
      voicePtt: true,
      sticker: true,
      location: true,
    },
    parseInbound: vi.fn(async () => []),
    sendText,
    sendMedia: vi.fn(async () => ok),
    sendTemplate: vi.fn(async () => ok),
    sendInteractive: vi.fn(async () => ok),
    downloadMedia: vi.fn(async () => Buffer.alloc(0)),
    markAsRead: vi.fn(async () => undefined),
    sendTypingIndicator: typing,
  };
  const channel: Channel = {
    id: 'ch1',
    workspaceId: 'ws1',
    provider: 'meta_whatsapp',
    accessToken: 'tok',
    phoneNumberId: 'pn1',
  };
  const persist = vi.fn(async (_input: unknown) => undefined);
  const deps: OutboundDeps = {
    channels: { resolve: vi.fn(async () => ({ channel, adapter })) },
    persistence: { persist },
    socket: {
      emitStatusChanged: vi.fn(async () => undefined),
      emitMessageNew: vi.fn(async () => undefined),
    },
  };
  return { deps, persist, sendText, typing };
}

const gateFor = (row: WorkspaceSubscriptionRow | null) =>
  createSubscriptionGate({ load: async () => row });

const envelope = (payload: Record<string, unknown>): Envelope => ({
  id: '00000000-0000-0000-0000-000000000001',
  type: 'outbound.text',
  workspaceId: '00000000-0000-0000-0000-0000000000ff',
  ts: Date.now(),
  payload: { channelId: 'ch1', conversationId: 'cv1', messageId: 'm1', chatId: 'c', ...payload },
});
const text = envelope({ kind: 'text', text: 'oi' });
const typingEnv = envelope({
  kind: 'typing_indicator',
  targetExternalId: 'wamid.in',
  presence: 'typing',
});

describe('outbound — portão de assinatura (F-02)', () => {
  for (const [label, row] of [
    ['expired', { subscriptionStatus: 'expired', trialEndsAt: null }],
    ['canceled', { subscriptionStatus: 'canceled', trialEndsAt: null }],
    ['trial vencido', { subscriptionStatus: 'trial', trialEndsAt: new Date(Date.now() - 1000) }],
    ['empresa inexistente', null],
  ] as const) {
    it(`${label}: não envia, persiste failed com o motivo e dá ack (não lança)`, async () => {
      const d = setup();
      await handleOutboundEnvelope(text, {
        deps: d.deps,
        logger,
        consentGate: allowAllConsentGate,
        subscriptionGate: gateFor(row),
      });
      expect(d.sendText).not.toHaveBeenCalled();
      expect(d.persist).toHaveBeenCalledOnce();
      expect(d.persist.mock.calls[0]?.[0]).toMatchObject({
        messageId: 'm1',
        status: 'failed',
        errorCode: SKIPPED_SUBSCRIPTION_INACTIVE,
      });
    });
  }

  for (const [label, row] of [
    ['active', { subscriptionStatus: 'active', trialEndsAt: null }],
    ['past_due', { subscriptionStatus: 'past_due', trialEndsAt: null }],
    ['trial válido', { subscriptionStatus: 'trial', trialEndsAt: new Date(Date.now() + 1e7) }],
  ] as const) {
    it(`${label}: envia normalmente`, async () => {
      const d = setup();
      await handleOutboundEnvelope(text, {
        deps: d.deps,
        logger,
        consentGate: allowAllConsentGate,
        subscriptionGate: gateFor(row),
      });
      expect(d.sendText).toHaveBeenCalledOnce();
    });
  }

  it('typing_indicator não é bloqueado nem consulta o portão', async () => {
    const d = setup();
    const check = vi.fn(async () => ({ active: false, status: 'expired' }) as const);
    await handleOutboundEnvelope(typingEnv, {
      deps: d.deps,
      logger,
      consentGate: allowAllConsentGate,
      subscriptionGate: { check },
    });
    expect(check).not.toHaveBeenCalled();
    expect(d.typing).toHaveBeenCalledOnce();
  });
});
