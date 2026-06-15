/**
 * F31-S01 — testes do OutboundPublisher real do worker de flows.
 *
 * Unitarios, sem Postgres/RabbitMQ no loop: injeta storage fake, persistencia fake e
 * `publishJob` fake (captura os jobs). Alem de checar o shape, valida CADA job produzido
 * contra `parseOutboundJob` (a fonte da verdade do worker outbound) — prova que a bridge
 * monta exatamente o que o consumidor exige.
 */
import { describe, expect, it } from 'vitest';
import { createLogger } from '@hm/logger';
import type { IStorageDriver, PutObjectInput, SignedUrl } from '@hm/storage';
import { parseOutboundJob } from '../outbound/job';
import {
  createOutboundPublisher,
  type OutboundPersistencePort,
  type PersistOutboundMessageInput,
} from './outbound-publisher';

const logger = createLogger('error');

/** Storage fake: registra as chaves assinadas e devolve uma URL servivel valida. */
class FakeStorage implements IStorageDriver {
  readonly signedFor: string[] = [];
  async put(_input: PutObjectInput): Promise<void> {
    /* unused */
  }
  async getSignedUrl(key: string): Promise<SignedUrl> {
    this.signedFor.push(key);
    return { url: `https://cdn.test/${key}?sig=abc`, expiresAt: new Date(Date.now() + 3_600_000) };
  }
  async delete(_key: string): Promise<void> {
    /* unused */
  }
}

interface FakePersistence {
  readonly port: OutboundPersistencePort;
  readonly inserts: PersistOutboundMessageInput[];
}

/** Persistencia fake: captura os inserts e devolve canal/remoteId/messageId fixos. */
function makePersistence(opts?: {
  conversationExists?: boolean;
  targetExternalId?: string | null;
}): FakePersistence {
  const inserts: PersistOutboundMessageInput[] = [];
  const exists = opts?.conversationExists ?? true;
  const targetExternalId = opts?.targetExternalId === undefined ? 'wamid.IN1' : opts.targetExternalId;
  const port: OutboundPersistencePort = {
    async persistOutboundMessage(input) {
      inserts.push(input);
      if (!exists) return null;
      return { channelId: 'ch-1', remoteId: '5511999990000', messageId: 'msg-1' };
    },
    async resolvePresenceTarget() {
      if (!exists) return null;
      return { channelId: 'ch-1', remoteId: '5511999990000', targetExternalId };
    },
  };
  return { port, inserts };
}

interface Harness {
  readonly publisher: ReturnType<typeof createOutboundPublisher>;
  readonly jobs: Record<string, unknown>[];
  readonly storage: FakeStorage;
  readonly persistence: FakePersistence;
}

function makeHarness(opts?: Parameters<typeof makePersistence>[0]): Harness {
  const jobs: Record<string, unknown>[] = [];
  const storage = new FakeStorage();
  const persistence = makePersistence(opts);
  const publisher = createOutboundPublisher({
    logger,
    storage,
    persistence: persistence.port,
    publishJob: async (_ws, job) => {
      jobs.push(job);
      return true;
    },
  });
  return { publisher, jobs, storage, persistence };
}

describe('createOutboundPublisher.publishMessage', () => {
  it('texto → job kind text com shape exato (passa parseOutboundJob)', async () => {
    const h = makeHarness();
    await h.publisher.publishMessage('ws-1', { conversationId: 'conv-1', text: '  Olá mundo  ' });

    expect(h.jobs).toHaveLength(1);
    const job = h.jobs[0]!;
    expect(job).toMatchObject({
      kind: 'text',
      channelId: 'ch-1',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      chatId: '5511999990000',
      text: 'Olá mundo',
    });
    expect(() => parseOutboundJob(job)).not.toThrow();
    expect(h.persistence.inserts[0]).toMatchObject({ type: 'text', content: 'Olá mundo' });
  });

  it('imagem → resolve signed url e emite job media com publicMediaUrl/mime/caption', async () => {
    const h = makeHarness();
    await h.publisher.publishMessage('ws-1', {
      conversationId: 'conv-1',
      mediaStorageKey: 'ws-1/media/foto.png',
      mediaType: 'image/png',
      caption: 'minha foto',
    });

    expect(h.storage.signedFor).toContain('ws-1/media/foto.png');
    expect(h.jobs).toHaveLength(1);
    const job = h.jobs[0]!;
    expect(job).toMatchObject({
      kind: 'media',
      mediaKind: 'image',
      mime: 'image/png',
      caption: 'minha foto',
      chatId: '5511999990000',
    });
    expect(job['publicMediaUrl']).toBe('https://cdn.test/ws-1/media/foto.png?sig=abc');
    expect(() => parseOutboundJob(job)).not.toThrow();
    expect(h.persistence.inserts[0]).toMatchObject({
      type: 'image',
      mediaMime: 'image/png',
      mediaCaption: 'minha foto',
      mediaUrl: 'https://cdn.test/ws-1/media/foto.png?sig=abc',
    });
  });

  it('documento sem mediaKind explicito → deriva do MIME (application/pdf → document)', async () => {
    const h = makeHarness();
    await h.publisher.publishMessage('ws-1', {
      conversationId: 'conv-1',
      mediaStorageKey: 'ws-1/media/contrato.pdf',
      mediaType: 'application/pdf',
    });
    const job = h.jobs[0]!;
    expect(job).toMatchObject({ kind: 'media', mediaKind: 'document', mime: 'application/pdf' });
    expect(job['caption']).toBeUndefined();
    expect(() => parseOutboundJob(job)).not.toThrow();
  });

  it('audio voice → mediaKind voice; audio_file → mediaKind audio', async () => {
    const voice = makeHarness();
    await voice.publisher.publishMessage('ws-1', {
      conversationId: 'conv-1',
      mediaStorageKey: 'ws-1/media/nota.ogg',
      mediaType: 'audio/ogg',
      audioMessageKind: 'voice',
    });
    expect(voice.jobs[0]).toMatchObject({ kind: 'media', mediaKind: 'voice' });
    expect(() => parseOutboundJob(voice.jobs[0]!)).not.toThrow();

    const file = makeHarness();
    await file.publisher.publishMessage('ws-1', {
      conversationId: 'conv-1',
      mediaStorageKey: 'ws-1/media/musica.mp3',
      mediaType: 'audio/mpeg',
      audioMessageKind: 'audio_file',
    });
    expect(file.jobs[0]).toMatchObject({ kind: 'media', mediaKind: 'audio' });
    expect(() => parseOutboundJob(file.jobs[0]!)).not.toThrow();
  });

  it('midia sem mediaType (MIME) → no-op (nao assina, nao enfileira)', async () => {
    const h = makeHarness();
    await h.publisher.publishMessage('ws-1', {
      conversationId: 'conv-1',
      mediaStorageKey: 'ws-1/media/x.bin',
    });
    expect(h.storage.signedFor).toHaveLength(0);
    expect(h.jobs).toHaveLength(0);
  });

  it('texto vazio → no-op', async () => {
    const h = makeHarness();
    await h.publisher.publishMessage('ws-1', { conversationId: 'conv-1', text: '   ' });
    expect(h.jobs).toHaveLength(0);
  });

  it('interactivePayload → no-op conservador (sem bridge ainda)', async () => {
    const h = makeHarness();
    await h.publisher.publishMessage('ws-1', {
      conversationId: 'conv-1',
      interactivePayload: { kind: 'buttons', body: 'Escolha', buttons: [] },
    });
    expect(h.jobs).toHaveLength(0);
  });

  it('conversa inexistente/invisivel → no-op', async () => {
    const h = makeHarness({ conversationExists: false });
    await h.publisher.publishMessage('ws-1', { conversationId: 'conv-x', text: 'olá' });
    expect(h.jobs).toHaveLength(0);
  });
});

describe('createOutboundPublisher.publishPresence', () => {
  it('typing → job typing_indicator com alvo da ultima inbound (passa parseOutboundJob)', async () => {
    const h = makeHarness({ targetExternalId: 'wamid.IN1' });
    await h.publisher.publishPresence('ws-1', {
      conversationId: 'conv-1',
      presence: 'typing',
      durationMs: 1500,
    });
    expect(h.jobs).toHaveLength(1);
    const job = h.jobs[0]!;
    expect(job).toMatchObject({
      kind: 'typing_indicator',
      channelId: 'ch-1',
      conversationId: 'conv-1',
      chatId: '5511999990000',
      targetExternalId: 'wamid.IN1',
      presence: 'typing',
    });
    expect(typeof job['messageId']).toBe('string');
    expect((job['messageId'] as string).length).toBeGreaterThan(0);
    expect(() => parseOutboundJob(job)).not.toThrow();
  });

  it('recording → presence recording', async () => {
    const h = makeHarness();
    await h.publisher.publishPresence('ws-1', {
      conversationId: 'conv-1',
      presence: 'recording',
      durationMs: 2000,
    });
    expect(h.jobs[0]).toMatchObject({ kind: 'typing_indicator', presence: 'recording' });
  });

  it('sem inbound enderecavel → no-op silencioso', async () => {
    const h = makeHarness({ targetExternalId: null });
    await h.publisher.publishPresence('ws-1', {
      conversationId: 'conv-1',
      presence: 'typing',
      durationMs: 1500,
    });
    expect(h.jobs).toHaveLength(0);
  });

  it('conversa inexistente → no-op', async () => {
    const h = makeHarness({ conversationExists: false });
    await h.publisher.publishPresence('ws-1', {
      conversationId: 'conv-x',
      presence: 'typing',
      durationMs: 1500,
    });
    expect(h.jobs).toHaveLength(0);
  });
});
