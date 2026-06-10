/**
 * Testes do worker outbound (F1-S07): parse Zod, dispatch (kind↔provider),
 * lock FIFO por conversa e finalize (persist + socket).
 *
 * NB: requer `vitest` no `package.json` de `@hm/workers` (a adicionar pela
 * orquestração — ver relatório do slot). A lógica não depende de RabbitMQ:
 * `handleOutboundEnvelope` é testado com portas fake.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Channel, IChannelAdapter, SendResult } from '@hm/channels';
import { InMemoryFifoLockStore, runWithDistributedLock } from '../lock';
import { parseOutboundJob } from './job';
import { dispatchOutbound } from './dispatch';
import { handleOutboundEnvelope } from './worker';
import type { OutboundDeps } from './ports';
import type { Envelope } from '@hm/shared/mq';

function makeChannel(provider: Channel['provider']): Channel {
  return { id: 'ch1', workspaceId: 'ws1', provider, accessToken: 'tok', phoneNumberId: 'pn1' };
}

function okAdapter(provider: Channel['provider']): IChannelAdapter {
  const ok: SendResult = { ok: true, externalId: 'wamid.X' };
  return {
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
    sendText: vi.fn(async () => ok),
    sendMedia: vi.fn(async () => ok),
    sendTemplate: vi.fn(async () => ok),
    sendInteractive: vi.fn(async () => ok),
    downloadMedia: vi.fn(async () => Buffer.alloc(0)),
    markAsRead: vi.fn(async () => undefined),
    sendTypingIndicator: vi.fn(async () => undefined),
  };
}

describe('parseOutboundJob', () => {
  it('aceita um job text válido', () => {
    const job = parseOutboundJob({
      kind: 'text',
      channelId: 'ch1',
      conversationId: 'cv1',
      messageId: 'm1',
      chatId: '5511999',
      text: 'oi',
    });
    expect(job.kind).toBe('text');
  });

  it('rejeita payload inválido', () => {
    expect(() => parseOutboundJob({ kind: 'text' })).toThrow();
  });
});

describe('dispatchOutbound — coerência kind↔provider', () => {
  it('roteia text ao adapter', async () => {
    const channel = makeChannel('waha');
    const adapter = okAdapter('waha');
    const job = parseOutboundJob({
      kind: 'text',
      channelId: 'ch1',
      conversationId: 'cv1',
      messageId: 'm1',
      chatId: 'c',
      text: 'hi',
    });
    const res = await dispatchOutbound(job, channel, adapter);
    expect(res.dispatched).toBe(true);
    expect(res.result.ok).toBe(true);
    expect(adapter.sendText).toHaveBeenCalledOnce();
  });

  it('rejeita template fora do meta_whatsapp (mismatch, sem chamar adapter)', async () => {
    const channel = makeChannel('waha');
    const adapter = okAdapter('waha');
    const job = parseOutboundJob({
      kind: 'template',
      channelId: 'ch1',
      conversationId: 'cv1',
      messageId: 'm1',
      chatId: 'c',
      templateName: 'hello',
      languageCode: 'pt_BR',
      components: [],
    });
    const res = await dispatchOutbound(job, channel, adapter);
    expect(res.dispatched).toBe(false);
    expect(res.result.ok).toBe(false);
    if (!res.result.ok) expect(res.result.errorCode).toBe('OUTBOUND_KIND_PROVIDER_MISMATCH');
    expect(adapter.sendTemplate).not.toHaveBeenCalled();
  });
});

describe('runWithDistributedLock — FIFO por chave', () => {
  it('serializa e preserva ordem de chegada', async () => {
    const store = new InMemoryFifoLockStore();
    const order: number[] = [];
    const run = (n: number, delay: number) =>
      runWithDistributedLock(
        'k',
        1000,
        async () => {
          await new Promise((r) => setTimeout(r, delay));
          order.push(n);
        },
        store,
      );
    // 1 entra primeiro (lento); 2 e 3 enfileiram na ordem.
    await Promise.all([run(1, 30), run(2, 1), run(3, 1)]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('chaves distintas correm em paralelo', async () => {
    const store = new InMemoryFifoLockStore();
    let concurrent = 0;
    let max = 0;
    const run = (key: string) =>
      runWithDistributedLock(
        key,
        1000,
        async () => {
          concurrent += 1;
          max = Math.max(max, concurrent);
          await new Promise((r) => setTimeout(r, 10));
          concurrent -= 1;
        },
        store,
      );
    await Promise.all([run('a'), run('b')]);
    expect(max).toBe(2);
  });
});

describe('handleOutboundEnvelope — finalize', () => {
  function deps(provider: Channel['provider']): {
    deps: OutboundDeps;
    persist: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
  } {
    const persist = vi.fn(async () => undefined);
    const emit = vi.fn(async () => undefined);
    return {
      persist,
      emit,
      deps: {
        channels: { resolve: vi.fn(async () => ({ channel: makeChannel(provider), adapter: okAdapter(provider) })) },
        persistence: { persist },
        socket: { emitStatusChanged: emit },
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

  it('persiste sent e emite status em sucesso', async () => {
    const d = deps('waha');
    const envelope: Envelope = {
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
        text: 'hi',
      },
    };
    await handleOutboundEnvelope(envelope, { deps: d.deps, logger });
    expect(d.persist).toHaveBeenCalledOnce();
    expect(d.emit).toHaveBeenCalledOnce();
    expect(d.persist.mock.calls[0]?.[0]).toMatchObject({ status: 'sent', externalId: 'wamid.X' });
  });
});
