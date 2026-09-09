/**
 * F59-S05 — o portão de consentimento no caminho de envio.
 *
 * A REGRA é testada sem banco em `@hm/shared/consent.test.ts` (22 casos). Aqui o
 * que importa é a integração: nenhum envio chega ao adapter sem passar pelo
 * portão, a recusa vira status visível, e a presença não é bloqueada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, IChannelAdapter, SendResult } from '@hm/channels';
import type { Envelope } from '@hm/shared/mq';
import type { OutboundDecision } from '@hm/shared';
import { handleOutboundEnvelope } from './worker';
import type { ConsentGatePort, OutboundDeps } from './ports';
import { allowAllConsentGate } from './consent-gate';
import { purposeOf } from './job';

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function makeChannel(provider: Channel['provider']): Channel {
  return { id: 'ch1', workspaceId: 'ws1', provider, accessToken: 'tok', phoneNumberId: 'pn1' };
}

function adapterEspiao(provider: Channel['provider']): {
  adapter: IChannelAdapter;
  sendText: ReturnType<typeof vi.fn>;
} {
  const ok: SendResult = { ok: true, externalId: 'wamid.X' };
  const sendText = vi.fn(async () => ok);
  return {
    sendText,
    adapter: {
      provider,
      capabilities: {
        templatesHSM: provider === 'meta_whatsapp',
        storyMentions: false,
        storyReplies: false,
        publicComments: false,
        messageTags: provider === 'meta_instagram',
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
      sendTypingIndicator: vi.fn(async () => undefined),
    },
  };
}

function fakeDeps(provider: Channel['provider']): {
  deps: OutboundDeps;
  persist: ReturnType<typeof vi.fn>;
  sendText: ReturnType<typeof vi.fn>;
  typing: ReturnType<typeof vi.fn>;
} {
  const persist = vi.fn(async () => undefined);
  const { adapter, sendText } = adapterEspiao(provider);
  return {
    persist,
    sendText,
    typing: adapter.sendTypingIndicator as ReturnType<typeof vi.fn>,
    deps: {
      channels: { resolve: vi.fn(async () => ({ channel: makeChannel(provider), adapter })) },
      persistence: { persist },
      socket: {
        emitStatusChanged: vi.fn(async () => undefined),
        emitMessageNew: vi.fn(async () => undefined),
      },
    },
  };
}

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(function (this: unknown) {
    return logger;
  }),
};

function gateQueRecusa(decision: Omit<OutboundDecision & { allowed: false }, 'allowed'>): {
  gate: ConsentGatePort;
  check: ReturnType<typeof vi.fn>;
} {
  const check = vi.fn(async () => ({ allowed: false, ...decision }) as OutboundDecision);
  return { gate: { check }, check };
}

function envelopeTexto(payload: Record<string, unknown> = {}): Envelope {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    type: 'outbound.text',
    workspaceId: '00000000-0000-0000-0000-0000000000ff',
    ts: Date.now(),
    payload: {
      kind: 'text',
      channelId: 'ch1',
      conversationId: 'cv1',
      messageId: 'm1',
      chatId: 'c',
      text: 'oi',
      ...payload,
    },
  };
}

describe('o portão está no caminho, não ao lado dele', () => {
  it('recusa impede o adapter de ser chamado', async () => {
    const d = fakeDeps('meta_whatsapp');
    const { gate } = gateQueRecusa({
      reason: 'no_consent',
      message: 'Sem consentimento registrado.',
      usedFallbackTimezone: false,
      timezone: 'America/New_York',
    });

    await handleOutboundEnvelope(envelopeTexto({ purpose: 'marketing' }), {
      deps: d.deps,
      logger,
      consentGate: gate,
    });

    expect(d.sendText).not.toHaveBeenCalled();
  });

  it('recusa NUNCA é silenciosa: vira status failed com código do motivo', async () => {
    const d = fakeDeps('meta_whatsapp');
    const { gate } = gateQueRecusa({
      reason: 'suppressed',
      message: 'Contato pediu para não receber mais mensagens.',
      usedFallbackTimezone: false,
      timezone: 'America/Sao_Paulo',
    });

    await handleOutboundEnvelope(envelopeTexto(), { deps: d.deps, logger, consentGate: gate });

    expect(d.persist).toHaveBeenCalledOnce();
    expect(d.persist.mock.calls[0]?.[0]).toMatchObject({
      status: 'failed',
      errorCode: 'consent_suppressed',
    });
  });

  it('o motivo vai para o código do erro, um por motivo — vira métrica e triagem', async () => {
    for (const reason of [
      'no_consent',
      'quiet_hours',
      'registration_pending',
      'channel_disabled',
    ] as const) {
      const d = fakeDeps('meta_whatsapp');
      const { gate } = gateQueRecusa({
        reason,
        message: 'recusado',
        usedFallbackTimezone: false,
        timezone: 'UTC',
      });
      await handleOutboundEnvelope(envelopeTexto(), { deps: d.deps, logger, consentGate: gate });
      expect(d.persist.mock.calls[0]?.[0]).toMatchObject({ errorCode: `consent_${reason}` });
    }
  });

  it('o portão recebe a finalidade declarada no job', async () => {
    const d = fakeDeps('meta_whatsapp');
    const check = vi.fn(
      async () => ({ allowed: true, usedFallbackTimezone: false, timezone: 'UTC' }) as OutboundDecision,
    );

    await handleOutboundEnvelope(envelopeTexto({ purpose: 'marketing' }), {
      deps: d.deps,
      logger,
      consentGate: { check },
    });

    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'marketing', conversationId: 'cv1' }),
    );
  });

  it('job sem finalidade é tratado como transacional, não como marketing', async () => {
    // Jobs produzidos antes desta fase não carregam `purpose`. Tratá-los como
    // marketing bloquearia a operação inteira do cliente no primeiro deploy.
    const d = fakeDeps('meta_whatsapp');
    const check = vi.fn(
      async () => ({ allowed: true, usedFallbackTimezone: false, timezone: 'UTC' }) as OutboundDecision,
    );

    await handleOutboundEnvelope(envelopeTexto(), { deps: d.deps, logger, consentGate: { check } });

    expect(check).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'transactional' }));
  });

  it('envio permitido segue normalmente até o adapter', async () => {
    const d = fakeDeps('meta_whatsapp');
    await handleOutboundEnvelope(envelopeTexto(), {
      deps: d.deps,
      logger,
      consentGate: allowAllConsentGate,
    });
    expect(d.sendText).toHaveBeenCalledOnce();
    expect(d.persist.mock.calls[0]?.[0]).toMatchObject({ status: 'sent' });
  });
});

describe('presença não é mensagem', () => {
  it('typing_indicator não consulta o portão nem é bloqueado', async () => {
    const d = fakeDeps('meta_whatsapp');
    const { gate, check } = gateQueRecusa({
      reason: 'suppressed',
      message: 'suprimido',
      usedFallbackTimezone: false,
      timezone: 'UTC',
    });

    await handleOutboundEnvelope(
      {
        id: '00000000-0000-0000-0000-000000000002',
        type: 'outbound.typing',
        workspaceId: '00000000-0000-0000-0000-0000000000ff',
        ts: Date.now(),
        payload: {
          kind: 'typing_indicator',
          channelId: 'ch1',
          conversationId: 'cv1',
          messageId: 'm1',
          chatId: 'c',
          targetExternalId: 'wamid.PREV',
          presence: 'typing',
        },
      },
      { deps: d.deps, logger, consentGate: gate },
    );

    // Presença não carrega conteúdo e não é marketing: bloqueá-la degradaria a
    // UX sem nenhum ganho de conformidade.
    expect(check).not.toHaveBeenCalled();
  });
});

describe('purposeOf', () => {
  it('ausente é transacional; presente é o que veio', () => {
    const base = {
      kind: 'text' as const,
      channelId: 'c',
      conversationId: 'cv',
      messageId: 'm',
      chatId: 'x',
      text: 'oi',
    };
    expect(purposeOf(base)).toBe('transactional');
    expect(purposeOf({ ...base, purpose: 'marketing' })).toBe('marketing');
    expect(purposeOf({ ...base, purpose: 'transactional' })).toBe('transactional');
  });
});
