/**
 * Testes do worker outbound (F1-S07): parse Zod, dispatch (kind↔provider),
 * lock FIFO por conversa e finalize (persist + socket).
 *
 * NB: requer `vitest` no `package.json` de `@hm/workers` (a adicionar pela
 * orquestração — ver relatório do slot). A lógica não depende de RabbitMQ:
 * `handleOutboundEnvelope` é testado com portas fake.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Channel, IChannelAdapter, SendResult } from '@hm/channels';
import { InMemoryFifoLockStore, runWithDistributedLock } from '../lock';
import { parseOutboundJob } from './job';
import { dispatchOutbound } from './dispatch';
import { finalizeOutbound } from './finalize';
import { handleOutboundEnvelope } from './worker';
import type { OutboundDeps } from './ports';
import type { OrphanStatusStore } from '../inbound/status';
import type { Envelope } from '@hm/shared/mq';

// F52-S04: estes são unit tests de roteamento/finalize. O guard de idempotência
// e o orphan store DEFAULT batem no DB (`@hm/db`); aqui forçamos `DATABASE_URL`
// vazio para que no-opem — determinístico com ou sem Postgres dev no runner. Os
// caminhos de idempotência/reconciliação são exercitados com portas FAKE
// injetadas (ver describes F52-S04 abaixo).
beforeEach(() => {
  vi.stubEnv('DATABASE_URL', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

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

/** Adapter cujo envio FALHA (SendResult.ok=false) — exercita o caminho 'failed'. */
function failAdapter(provider: Channel['provider']): IChannelAdapter {
  const fail: SendResult = { ok: false, errorCode: 'send_failed', errorMessage: 'boom' };
  return {
    ...okAdapter(provider),
    sendText: vi.fn(async () => fail),
    sendMedia: vi.fn(async () => fail),
    sendTemplate: vi.fn(async () => fail),
    sendInteractive: vi.fn(async () => fail),
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

describe('dispatchOutbound — Instagram', () => {
  function igAdapter(): IChannelAdapter {
    const ok: SendResult = { ok: true, externalId: 'ig.mid.X' };
    const base = okAdapter('meta_instagram');
    return {
      ...base,
      sendPrivateReplyToComment: vi.fn(async () => ok),
      replyPublicToComment: vi.fn(async () => ok),
      hideComment: vi.fn(async () => undefined),
      deleteComment: vi.fn(async () => undefined),
    } as unknown as IChannelAdapter;
  }

  const igChannel: Channel = {
    id: 'ch1',
    workspaceId: 'ws1',
    provider: 'meta_instagram',
    accessToken: 'tok',
    igUserId: 'IGUSER_1',
  };

  it('roteia ig_public_reply ao adapter', async () => {
    const adapter = igAdapter();
    const job = parseOutboundJob({
      kind: 'ig_public_reply',
      channelId: 'ch1',
      conversationId: 'cv1',
      messageId: 'm1',
      commentId: 'C1',
      text: 'obrigado!',
    });
    const res = await dispatchOutbound(job, igChannel, adapter);
    expect(res.dispatched).toBe(true);
    expect(res.result.ok).toBe(true);
  });

  it('roteia ig_private_reply (comment-to-DM)', async () => {
    const adapter = igAdapter();
    const job = parseOutboundJob({
      kind: 'ig_private_reply',
      channelId: 'ch1',
      conversationId: 'cv1',
      messageId: 'm1',
      commentId: 'C1',
      text: 'no DM',
    });
    const res = await dispatchOutbound(job, igChannel, adapter);
    expect(res.dispatched).toBe(true);
    expect(res.result.ok).toBe(true);
  });

  it('ig_hide_comment retorna ok sem externalId de mensagem', async () => {
    const adapter = igAdapter();
    const job = parseOutboundJob({
      kind: 'ig_hide_comment',
      channelId: 'ch1',
      conversationId: 'cv1',
      messageId: 'm1',
      commentId: 'C1',
    });
    const res = await dispatchOutbound(job, igChannel, adapter);
    expect(res.dispatched).toBe(true);
    expect(res.result.ok).toBe(true);
  });

  it('rejeita ig_public_reply em canal WhatsApp (mismatch)', async () => {
    const adapter = okAdapter('meta_whatsapp');
    const job = parseOutboundJob({
      kind: 'ig_public_reply',
      channelId: 'ch1',
      conversationId: 'cv1',
      messageId: 'm1',
      commentId: 'C1',
      text: 'x',
    });
    const res = await dispatchOutbound(job, makeChannel('meta_whatsapp'), adapter);
    expect(res.dispatched).toBe(false);
    if (!res.result.ok) expect(res.result.errorCode).toBe('OUTBOUND_KIND_PROVIDER_MISMATCH');
  });

  it('text IG fora da janela 24h sem tag: bloqueado (nao chama adapter)', async () => {
    const adapter = igAdapter();
    const job = parseOutboundJob({
      kind: 'text',
      channelId: 'ch1',
      conversationId: 'cv1',
      messageId: 'm1',
      chatId: 'IGSID_1',
      text: 'oi',
      lastInboundFromContactAt: Date.now() - 48 * 3_600_000,
    });
    const res = await dispatchOutbound(job, igChannel, adapter);
    expect(res.dispatched).toBe(false);
    if (!res.result.ok) expect(res.result.errorCode).toBe('IG_WINDOW_CLOSED');
    expect(adapter.sendText).not.toHaveBeenCalled();
  });

  it('text IG fora da janela COM HUMAN_AGENT: envia com tag', async () => {
    const adapter = igAdapter();
    const job = parseOutboundJob({
      kind: 'text',
      channelId: 'ch1',
      conversationId: 'cv1',
      messageId: 'm1',
      chatId: 'IGSID_1',
      text: 'oi',
      messageTag: 'HUMAN_AGENT',
      lastInboundFromContactAt: Date.now() - 48 * 3_600_000,
    });
    const res = await dispatchOutbound(job, igChannel, adapter);
    expect(res.dispatched).toBe(true);
    expect(res.result.ok).toBe(true);
    expect(adapter.sendText).toHaveBeenCalledOnce();
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
    emitNew: ReturnType<typeof vi.fn>;
  } {
    const persist = vi.fn(async () => undefined);
    const emit = vi.fn(async () => undefined);
    const emitNew = vi.fn(async () => undefined);
    return {
      persist,
      emit,
      emitNew,
      deps: {
        channels: { resolve: vi.fn(async () => ({ channel: makeChannel(provider), adapter: okAdapter(provider) })) },
        persistence: { persist },
        socket: { emitStatusChanged: emit, emitMessageNew: emitNew },
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
    // Realtime do outbound: ao enviar, emite message:new (workspace:true) p/ a
    // ChatList reordenar + a thread aberta mostrar a mensagem ao vivo.
    expect(d.emitNew).toHaveBeenCalledOnce();
    expect(d.emitNew.mock.calls[0]?.[0]).toMatchObject({
      conversationId: 'cv1',
      messageId: 'm1',
      type: 'text',
      content: 'hi',
    });
  });

  it('falha no envio: persiste failed e NÃO emite message:new (não reordena a lista)', async () => {
    const d = deps('waha');
    // adapter que falha → SendResult.ok=false → status 'failed'.
    d.deps = {
      ...d.deps,
      channels: {
        resolve: vi.fn(async () => ({
          channel: makeChannel('waha'),
          adapter: failAdapter('waha'),
        })),
      },
    };
    const envelope: Envelope = {
      id: '00000000-0000-0000-0000-000000000002',
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
    expect(d.persist.mock.calls[0]?.[0]).toMatchObject({ status: 'failed' });
    expect(d.emitNew).not.toHaveBeenCalled();
  });
});

// ─── F52-S04: idempotência de envio (guard "já enviada") ──────────────────────

describe('dispatchOutbound — idempotência (F52-S04)', () => {
  function textJob() {
    return parseOutboundJob({
      kind: 'text',
      channelId: 'ch1',
      conversationId: 'cv1',
      messageId: 'm1',
      chatId: 'c',
      text: 'hi',
    });
  }

  it('redelivery: mensagem já tem external_id → NÃO chama o adapter (sem 2º envio)', async () => {
    const channel = makeChannel('waha');
    const adapter = okAdapter('waha');
    const guard = { findSentExternalId: vi.fn(async () => 'wamid.PRIOR') };

    const res = await dispatchOutbound(textJob(), channel, adapter, guard);

    expect(adapter.sendText).not.toHaveBeenCalled();
    expect(res.dispatched).toBe(false);
    if (!res.dispatched) expect(res.alreadySent).toBe(true);
    expect(res.result.ok).toBe(true);
    if (res.result.ok) expect(res.result.externalId).toBe('wamid.PRIOR');
    expect(guard.findSentExternalId).toHaveBeenCalledWith('m1', 'ws1');
  });

  it('primeira entrega: sem external_id → envia normalmente (adapter chamado 1×)', async () => {
    const channel = makeChannel('waha');
    const adapter = okAdapter('waha');
    const guard = { findSentExternalId: vi.fn(async () => null) };

    const res = await dispatchOutbound(textJob(), channel, adapter, guard);

    expect(adapter.sendText).toHaveBeenCalledOnce();
    expect(res.dispatched).toBe(true);
  });
});

// ─── F52-S04: reconciliação de status órfão (callback antes do external_id) ────

describe('finalizeOutbound — reconciliação de órfão (F52-S04)', () => {
  function fakeDeps(): {
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
        channels: { resolve: vi.fn() },
        persistence: { persist },
        socket: { emitStatusChanged: emit, emitMessageNew: vi.fn(async () => undefined) },
      },
    };
  }

  const job = parseOutboundJob({
    kind: 'text',
    channelId: 'ch1',
    conversationId: 'cv1',
    messageId: 'm1',
    chatId: 'c',
    text: 'hi',
  });

  it('aplica o status órfão (delivered) bufferizado quando o external_id é persistido', async () => {
    const { deps, persist, emit } = fakeDeps();
    const orphan: OrphanStatusStore = {
      record: vi.fn(async () => undefined),
      drain: vi.fn(async () => ({ externalId: 'wamid.X', status: 'delivered' as const, at: new Date() })),
    };

    await finalizeOutbound(job, { ok: true, externalId: 'wamid.X' }, 'ws1', deps, orphan);

    expect(orphan.drain).toHaveBeenCalledWith('wamid.X');
    // 1º persist = sent (envio); 2º persist = delivered (reconciliação do órfão).
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[0]?.[0]).toMatchObject({ status: 'sent', externalId: 'wamid.X' });
    expect(persist.mock.calls[1]?.[0]).toMatchObject({ status: 'delivered', externalId: 'wamid.X' });
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1]?.[0]).toMatchObject({ status: 'delivered' });
  });

  it('sem órfão bufferizado: persiste e emite uma única vez (sent)', async () => {
    const { deps, persist, emit } = fakeDeps();
    const orphan: OrphanStatusStore = {
      record: vi.fn(async () => undefined),
      drain: vi.fn(async () => null),
    };

    await finalizeOutbound(job, { ok: true, externalId: 'wamid.X' }, 'ws1', deps, orphan);

    expect(persist).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledOnce();
  });

  it('órfão que não avança (sent sobre sent) não reaplica (monotônico)', async () => {
    const { deps, persist } = fakeDeps();
    const orphan: OrphanStatusStore = {
      record: vi.fn(async () => undefined),
      drain: vi.fn(async () => ({ externalId: 'wamid.X', status: 'sent' as const, at: new Date() })),
    };

    await finalizeOutbound(job, { ok: true, externalId: 'wamid.X' }, 'ws1', deps, orphan);

    expect(persist).toHaveBeenCalledOnce();
  });

  it('falha definitiva → status failed + failedReason persistido, sem drenar órfão', async () => {
    const { deps, persist, emit } = fakeDeps();
    const orphan: OrphanStatusStore = {
      record: vi.fn(async () => undefined),
      drain: vi.fn(async () => null),
    };

    await finalizeOutbound(
      job,
      { ok: false, errorCode: 'PROVIDER_DOWN', errorMessage: 'boom' },
      'ws1',
      deps,
      orphan,
    );

    expect(persist).toHaveBeenCalledOnce();
    expect(persist.mock.calls[0]?.[0]).toMatchObject({ status: 'failed', errorCode: 'PROVIDER_DOWN' });
    expect(emit.mock.calls[0]?.[0]).toMatchObject({ status: 'failed' });
    expect(orphan.drain).not.toHaveBeenCalled();
  });
});
