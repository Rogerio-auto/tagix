/**
 * Testes do worker inbound (F1-S04): parse por provider (WA real, IG
 * placeholder), extração de routing hints, enfileiramento de mídia e publicação
 * da requisição de persistência. A lógica não depende de RabbitMQ:
 * `handleInboundEnvelope`/`runInboundPipeline` são testados com portas fake.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Envelope } from '@hm/shared/mq';
import type { InboundEvent } from '@hm/channels';
import type { ChannelProvider } from '@hm/shared';
import { handleInboundEnvelope } from './worker';
import { runInboundPipeline } from './pipeline';
import { ChannelInboundParser, extractRoutingHints } from './parse';
import type {
  InboundDeps,
  InboundMediaJob,
  PersistInboundRequest,
  PersistInboundResult,
} from './ports';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(function (this: unknown) {
    return logger;
  }),
};

function makeDeps(events: InboundEvent[]): {
  deps: InboundDeps;
  persist: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
  parse: ReturnType<typeof vi.fn>;
} {
  const persistResult: PersistInboundResult = {
    inserted: events.filter((e) => e.type === 'message').length,
    deduped: 0,
    statuses: events.filter((e) => e.type === 'status').length,
    resolved: true,
  };
  const persist = vi.fn(async (_req: PersistInboundRequest) => persistResult);
  const enqueue = vi.fn(async (_job: InboundMediaJob) => undefined);
  const parse = vi.fn((_provider: ChannelProvider, _raw: unknown) => events);
  return {
    persist,
    enqueue,
    parse,
    deps: {
      parser: { parse },
      persistence: { persist },
      media: { enqueue },
    },
  };
}

/** Webhook WA mínimo com uma mensagem de texto. */
function waTextEnvelope(): Envelope {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    type: 'inbound.message',
    workspaceId: '00000000-0000-0000-0000-000000000000',
    ts: Date.now(),
    payload: {
      provider: 'meta_whatsapp',
      raw: {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WABA_ID',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: 'PN123' },
                  messages: [
                    { id: 'wamid.A', from: '5511999', type: 'text', timestamp: '1700000000', text: { body: 'oi' } },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
  };
}

const textEvent: InboundEvent = {
  type: 'message',
  provider: 'meta_whatsapp',
  contactRemoteId: '5511999',
  externalId: 'wamid.A',
  messageType: 'text',
  content: 'oi',
  rawTimestamp: '2023-11-14T22:13:20.000Z',
};

const imageEvent: InboundEvent = {
  type: 'message',
  provider: 'meta_whatsapp',
  contactRemoteId: '5511999',
  externalId: 'wamid.B',
  messageType: 'image',
  mediaRef: { refOrUrl: 'media-id-1', mimeType: 'image/jpeg' },
  rawTimestamp: '2023-11-14T22:13:21.000Z',
};

describe('handleInboundEnvelope — WA texto', () => {
  it('parseia, não enfileira mídia e publica persist', async () => {
    const d = makeDeps([textEvent]);
    await handleInboundEnvelope(waTextEnvelope(), { deps: d.deps, logger });

    expect(d.parse).toHaveBeenCalledWith('meta_whatsapp', expect.any(Object));
    expect(d.enqueue).not.toHaveBeenCalled();
    expect(d.persist).toHaveBeenCalledOnce();
    const req = d.persist.mock.calls[0]?.[0] as PersistInboundRequest;
    expect(req.provider).toBe('meta_whatsapp');
    expect(req.routing.phoneNumberId).toBe('PN123');
    expect(req.events).toHaveLength(1);
  });

  it('descarta envelope com payload inválido sem lançar nem persistir', async () => {
    const d = makeDeps([textEvent]);
    const bad: Envelope = {
      id: '00000000-0000-0000-0000-000000000002',
      type: 'inbound.message',
      workspaceId: '00000000-0000-0000-0000-000000000000',
      ts: Date.now(),
      payload: { provider: 'nope', raw: {} },
    };
    await handleInboundEnvelope(bad, { deps: d.deps, logger });
    expect(d.persist).not.toHaveBeenCalled();
    expect(d.parse).not.toHaveBeenCalled();
  });
});

describe('runInboundPipeline — mídia', () => {
  it('enfileira um media job por evento com mediaRef', async () => {
    const d = makeDeps([textEvent, imageEvent]);
    const result = await runInboundPipeline('meta_whatsapp', {}, d.deps, logger);

    expect(result.events).toBe(2);
    expect(result.mediaJobs).toBe(1);
    expect(result.persisted).toBe(true);
    expect(d.enqueue).toHaveBeenCalledOnce();
    const job = d.enqueue.mock.calls[0]?.[0] as InboundMediaJob;
    expect(job.externalId).toBe('wamid.B');
    expect(job.mediaRef.refOrUrl).toBe('media-id-1');
  });

  it('não persiste quando não há eventos (raw vazio / IG placeholder)', async () => {
    const d = makeDeps([]);
    const result = await runInboundPipeline('meta_whatsapp', {}, d.deps, logger);
    expect(result.persisted).toBe(false);
    expect(d.persist).not.toHaveBeenCalled();
    expect(d.enqueue).not.toHaveBeenCalled();
  });
});

describe('ChannelInboundParser — roteamento por provider', () => {
  const igEvent: InboundEvent = {
    type: 'message',
    provider: 'meta_instagram',
    contactRemoteId: 'IGSID',
    externalId: 'mid.1',
    messageType: 'text',
    content: 'oi',
    rawTimestamp: new Date().toISOString(),
  };
  const parsers = {
    metaWhatsApp: vi.fn(() => [textEvent]),
    waha: vi.fn(() => []),
    metaInstagram: vi.fn(() => [igEvent]),
  };
  const parser = new ChannelInboundParser(parsers, logger);

  it('delega WA ao parser de WhatsApp', () => {
    const out = parser.parse('meta_whatsapp', { object: 'whatsapp_business_account' });
    expect(parsers.metaWhatsApp).toHaveBeenCalledOnce();
    expect(out).toHaveLength(1);
  });

  it('delega IG ao parser de Instagram (F15-S03)', () => {
    const out = parser.parse('meta_instagram', { object: 'instagram' });
    expect(parsers.metaInstagram).toHaveBeenCalledOnce();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ provider: 'meta_instagram', messageType: 'text' });
  });
});

describe('extractRoutingHints', () => {
  it('WA → phone_number_id', () => {
    const hints = extractRoutingHints('meta_whatsapp', {
      entry: [{ changes: [{ value: { metadata: { phone_number_id: 'PN9' } } }] }],
    });
    expect(hints.phoneNumberId).toBe('PN9');
  });

  it('WAHA → session', () => {
    const hints = extractRoutingHints('waha', { session: 'default', payload: {} });
    expect(hints.wahaSession).toBe('default');
  });

  it('IG → igUserId (entry[].id)', () => {
    const hints = extractRoutingHints('meta_instagram', { entry: [{ id: 'IG_123' }] });
    expect(hints.igUserId).toBe('IG_123');
  });
});
