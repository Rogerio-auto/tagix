/**
 * Testes do safeguard de voz (hotfix Meta 131053).
 *
 * - Helper puro `isOggMagic`: reconhece "OggS"; rejeita mp3/octet-stream/curto.
 * - `resolveVoiceMediaKind` (fetcher injetado): OggS → mantém voice; não-ogg →
 *   rebaixa para audio; fetch lança / URL vazia → mantém voice (fail-safe).
 * - dispatch (com fetcher fake): job voice não-ogg → `sendMedia` com
 *   `mediaKind:'audio'`; job voice OggS → `mediaKind:'voice'`.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Channel, IChannelAdapter, SendResult } from '@hm/channels';
import { isOggMagic, resolveVoiceMediaKind, type VoiceMagicFetcher } from './voice-format';
import { dispatchOutbound } from './dispatch';
import type { OutboundSendGuard } from './db-ports';

const OGGS = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]); // "OggS"…
const MP3_ID3 = new Uint8Array([0x49, 0x44, 0x33, 0x04]); // "ID3"
const MP3_FRAME = new Uint8Array([0xff, 0xfb, 0x90, 0x00]); // MPEG frame sync
const OCTET = new Uint8Array([0x00, 0x00, 0x00, 0x00]);

describe('isOggMagic (puro)', () => {
  it('reconhece a magic OggS', () => {
    expect(isOggMagic(OGGS)).toBe(true);
  });
  it('rejeita mp3 (ID3)', () => {
    expect(isOggMagic(MP3_ID3)).toBe(false);
  });
  it('rejeita mp3 (frame sync 0xFF 0xFB)', () => {
    expect(isOggMagic(MP3_FRAME)).toBe(false);
  });
  it('rejeita octet-stream zerado', () => {
    expect(isOggMagic(OCTET)).toBe(false);
  });
  it('rejeita leitura curta (<4 bytes)', () => {
    expect(isOggMagic(new Uint8Array([0x4f, 0x67]))).toBe(false);
  });
});

describe('resolveVoiceMediaKind (fetcher injetado)', () => {
  it('mantém voice quando o binário é OggS', async () => {
    const fetcher: VoiceMagicFetcher = async () => OGGS;
    expect(await resolveVoiceMediaKind('https://r2/x.ogg', fetcher)).toBe('voice');
  });
  it('rebaixa para audio quando é mp3', async () => {
    const fetcher: VoiceMagicFetcher = async () => MP3_ID3;
    expect(await resolveVoiceMediaKind('https://r2/x.ogg', fetcher)).toBe('audio');
  });
  it('rebaixa para audio quando é octet-stream', async () => {
    const fetcher: VoiceMagicFetcher = async () => OCTET;
    expect(await resolveVoiceMediaKind('https://r2/x.ogg', fetcher)).toBe('audio');
  });
  it('fail-safe: fetch lança → mantém voice', async () => {
    const fetcher: VoiceMagicFetcher = async () => {
      throw new Error('network');
    };
    expect(await resolveVoiceMediaKind('https://r2/x.ogg', fetcher)).toBe('voice');
  });
  it('fail-safe: URL vazia → mantém voice (sem fetch)', async () => {
    const fetcher = vi.fn<VoiceMagicFetcher>(async () => OGGS);
    expect(await resolveVoiceMediaKind('', fetcher)).toBe('voice');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('fail-safe: leitura curta → mantém voice', async () => {
    const fetcher: VoiceMagicFetcher = async () => new Uint8Array([0x4f, 0x67]);
    expect(await resolveVoiceMediaKind('https://r2/x.ogg', fetcher)).toBe('voice');
  });
});

function makeChannel(): Channel {
  return {
    id: 'ch1',
    workspaceId: 'ws1',
    provider: 'meta_whatsapp',
    accessToken: 'tok',
    phoneNumberId: 'pn1',
  };
}

function adapterWithSpy(): { adapter: IChannelAdapter; sendMedia: ReturnType<typeof vi.fn> } {
  const ok: SendResult = { ok: true, externalId: 'wamid.X' };
  const sendMedia = vi.fn(async () => ok);
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
    sendText: vi.fn(async () => ok),
    sendMedia,
    sendTemplate: vi.fn(async () => ok),
    sendInteractive: vi.fn(async () => ok),
    downloadMedia: vi.fn(async () => Buffer.alloc(0)),
    markAsRead: vi.fn(async () => undefined),
    sendTypingIndicator: vi.fn(async () => undefined),
  };
  return { adapter, sendMedia };
}

// Guard no-op: nunca há external_id prévio → o adapter é chamado.
const noGuard: OutboundSendGuard = { findSentExternalId: async () => null };

function voiceJob() {
  return {
    kind: 'media' as const,
    channelId: 'ch1',
    conversationId: 'cv1',
    messageId: 'm1',
    chatId: '5511999',
    mediaKind: 'voice' as const,
    publicMediaUrl: 'https://r2/audio.ogg',
    mime: 'audio/ogg; codecs=opus',
  };
}

describe('dispatchOutbound — safeguard de voz', () => {
  it('job voice com conteúdo não-ogg → sendMedia com mediaKind audio', async () => {
    const { adapter, sendMedia } = adapterWithSpy();
    const fetcher: VoiceMagicFetcher = async () => MP3_FRAME;
    const res = await dispatchOutbound(voiceJob(), makeChannel(), adapter, noGuard, { fetcher });
    expect(res.dispatched).toBe(true);
    expect(sendMedia).toHaveBeenCalledTimes(1);
    const arg = sendMedia.mock.calls[0]?.[0] as { mediaKind: string };
    expect(arg.mediaKind).toBe('audio');
  });

  it('job voice com OggS → sendMedia com mediaKind voice', async () => {
    const { adapter, sendMedia } = adapterWithSpy();
    const fetcher: VoiceMagicFetcher = async () => OGGS;
    const res = await dispatchOutbound(voiceJob(), makeChannel(), adapter, noGuard, { fetcher });
    expect(res.dispatched).toBe(true);
    const arg = sendMedia.mock.calls[0]?.[0] as { mediaKind: string };
    expect(arg.mediaKind).toBe('voice');
  });

  it('fail-safe: fetch lança → mantém voice', async () => {
    const { adapter, sendMedia } = adapterWithSpy();
    const fetcher: VoiceMagicFetcher = async () => {
      throw new Error('timeout');
    };
    await dispatchOutbound(voiceJob(), makeChannel(), adapter, noGuard, { fetcher });
    const arg = sendMedia.mock.calls[0]?.[0] as { mediaKind: string };
    expect(arg.mediaKind).toBe('voice');
  });

  it('mediaKind audio comum não dispara o check (fetcher não chamado)', async () => {
    const { adapter, sendMedia } = adapterWithSpy();
    const fetcher = vi.fn<VoiceMagicFetcher>(async () => MP3_FRAME);
    const job = { ...voiceJob(), mediaKind: 'audio' as const };
    await dispatchOutbound(job, makeChannel(), adapter, noGuard, { fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    const arg = sendMedia.mock.calls[0]?.[0] as { mediaKind: string };
    expect(arg.mediaKind).toBe('audio');
  });
});
