/**
 * Testes do worker de mídia (F1-S10): parse Zod, key canônica, hash/extensão e
 * pipeline (download → sha → dedup → upload → update → emit) com portas fake.
 *
 * Sem RabbitMQ/DB/HTTP: `runMediaPipeline`/`handleMediaEnvelope` são exercitados
 * com fakes injetados. A política de erro (conteúdo morto = skip; infra = throw)
 * é verificada explicitamente.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { MetaError, type Channel, type IChannelAdapter } from '@hm/channels';
import type { Envelope } from '@hm/shared/mq';
import { parseMediaJob, type MediaJob } from './job';
import { sha256Hex, deriveExtension, effectiveMime } from './hash';
import { buildMediaKey, runMediaPipeline } from './pipeline';
import { handleMediaEnvelope } from './worker';
import type {
  MediaChannelResolver,
  MediaDeps,
  MediaMessageTarget,
  MediaPersistencePort,
  MediaRetryConfig,
  MediaSocketPort,
  MediaStoragePort,
  ResolvedMediaChannel,
} from './ports';

/** Retry sem espera real (sleep no-op) — testes determinísticos e rápidos. */
const fastRetry: MediaRetryConfig = {
  maxAttempts: 3,
  backoffMs: [0, 0],
  sleep: async (): Promise<void> => undefined,
};

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(function (this: unknown) {
    return logger;
  }),
};

const WS = '00000000-0000-0000-0000-0000000000aa';

function makeJob(overrides: Partial<MediaJob> = {}): MediaJob {
  return {
    provider: overrides.provider ?? 'meta_whatsapp',
    externalId: overrides.externalId ?? 'wamid.ABC',
    mediaRef: overrides.mediaRef ?? { refOrUrl: 'media-id-123', mimeType: 'image/jpeg' },
    routing: overrides.routing ?? { phoneNumberId: 'pn1' },
  };
}

function fakeAdapter(bytes: Buffer | (() => Promise<Buffer>)): IChannelAdapter {
  const download =
    typeof bytes === 'function' ? bytes : async (): Promise<Buffer> => bytes;
  return {
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
    sendText: vi.fn(async () => ({ ok: true, externalId: 'x' }) as const),
    sendMedia: vi.fn(async () => ({ ok: true, externalId: 'x' }) as const),
    sendTemplate: vi.fn(async () => ({ ok: true, externalId: 'x' }) as const),
    sendInteractive: vi.fn(async () => ({ ok: true, externalId: 'x' }) as const),
    downloadMedia: vi.fn(download),
    markAsRead: vi.fn(async () => undefined),
    sendTypingIndicator: vi.fn(async () => undefined),
  };
}

const channel: Channel = {
  id: 'ch1',
  workspaceId: WS,
  provider: 'meta_whatsapp',
  accessToken: 'tok',
  phoneNumberId: 'pn1',
};

interface Fakes {
  deps: MediaDeps;
  upload: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  emitFailed: ReturnType<typeof vi.fn>;
  markStatus: ReturnType<typeof vi.fn>;
  download: IChannelAdapter['downloadMedia'];
}

function fakes(opts: {
  bytes?: Buffer | (() => Promise<Buffer>);
  target?: MediaMessageTarget | null;
  keyBySha?: string | null;
  objectExists?: boolean;
  resolved?: ResolvedMediaChannel | null;
} = {}): Fakes {
  const bytes = opts.bytes ?? Buffer.from('hello-binary');
  const adapter = fakeAdapter(bytes);
  const resolved: ResolvedMediaChannel | null =
    opts.resolved === undefined ? { channel, adapter, workspaceId: WS } : opts.resolved;

  const target: MediaMessageTarget | null =
    opts.target === undefined
      ? { messageId: 'm1', conversationId: 'cv1', existingSha256: null }
      : opts.target;

  const upload = vi.fn(async () => undefined);
  const update = vi.fn(async () => undefined);
  const emit = vi.fn(async () => undefined);
  const emitFailed = vi.fn(async () => undefined);
  const markStatus = vi.fn(async () => undefined);

  const channels: MediaChannelResolver = { resolve: vi.fn(async () => resolved) };
  const storage: MediaStoragePort = {
    objectExists: vi.fn(async () => opts.objectExists ?? true),
    upload,
    publicUrl: vi.fn(async (key: string) => `https://cdn.test/${key}?sig=x`),
  };
  const persistence: MediaPersistencePort = {
    findMessage: vi.fn(async () => target),
    findKeyBySha256: vi.fn(async () => opts.keyBySha ?? null),
    update,
    markStatus,
  };
  const socket: MediaSocketPort = { emitMediaReady: emit, emitMediaFailed: emitFailed };

  return {
    deps: { channels, storage, persistence, socket, retry: fastRetry },
    upload,
    update,
    emit,
    emitFailed,
    markStatus,
    download: adapter.downloadMedia,
  };
}

describe('parseMediaJob', () => {
  it('aceita um job válido (espelha MqMediaEnqueue)', () => {
    const job = parseMediaJob({
      provider: 'meta_whatsapp',
      externalId: 'wamid.X',
      mediaRef: { refOrUrl: 'id', mimeType: 'image/png' },
      routing: { phoneNumberId: 'pn1' },
    });
    expect(job.externalId).toBe('wamid.X');
    expect(job.mediaRef.refOrUrl).toBe('id');
  });

  it('rejeita payload sem mediaRef', () => {
    expect(() =>
      parseMediaJob({ provider: 'waha', externalId: 'x', routing: {} }),
    ).toThrow();
  });

  it('rejeita provider desconhecido', () => {
    expect(() =>
      parseMediaJob({ provider: 'telegram', externalId: 'x', mediaRef: { refOrUrl: 'r' }, routing: {} }),
    ).toThrow();
  });
});

describe('hash + extensão', () => {
  it('sha256Hex casa com node:crypto', () => {
    const buf = Buffer.from('abc');
    expect(sha256Hex(buf)).toBe(createHash('sha256').update(buf).digest('hex'));
  });

  it('deriva extensão por MIME (preferido)', () => {
    expect(deriveExtension(makeJob({ mediaRef: { refOrUrl: 'r', mimeType: 'image/jpeg' } }))).toBe('jpg');
    expect(deriveExtension(makeJob({ mediaRef: { refOrUrl: 'r', mimeType: 'application/pdf' } }))).toBe('pdf');
  });

  it('cai no fileName quando MIME é desconhecido', () => {
    const job = makeJob({ mediaRef: { refOrUrl: 'r', mimeType: 'x/y', fileName: 'doc.CSV' } });
    expect(deriveExtension(job)).toBe('csv');
  });

  it('fallback bin sem MIME nem extensão útil', () => {
    expect(deriveExtension(makeJob({ mediaRef: { refOrUrl: 'r' } }))).toBe('bin');
  });

  it('effectiveMime cai em octet-stream sem MIME', () => {
    expect(effectiveMime(makeJob({ mediaRef: { refOrUrl: 'r' } }))).toBe('application/octet-stream');
  });
});

describe('buildMediaKey', () => {
  it('monta {wsId}/{yyyy}/{mm}/{dd}/{uuid}.{ext} em UTC', () => {
    const key = buildMediaKey('ws-x', 'jpg', new Date('2026-03-07T12:00:00Z'));
    expect(key).toMatch(/^ws-x\/2026\/03\/07\/[0-9a-f-]{36}\.jpg$/);
  });
});

describe('runMediaPipeline — happy path', () => {
  it('marca downloading, baixa, sobe, persiste media_*=ready e emite media_ready', async () => {
    const f = fakes({ objectExists: false });
    const res = await runMediaPipeline(makeJob(), f.deps, logger);

    expect(res.outcome).toBe('done');
    if (res.outcome === 'done') expect(res.deduped).toBe(false);

    // Transição in-flight ANTES do download.
    expect(f.markStatus).toHaveBeenCalledWith(WS, 'm1', 'downloading');

    expect(f.upload).toHaveBeenCalledOnce();
    expect(f.update).toHaveBeenCalledOnce();
    const persisted = f.update.mock.calls[0]?.[0];
    expect(persisted).toMatchObject({
      workspaceId: WS,
      messageId: 'm1',
      mediaMime: 'image/jpeg',
      mediaSizeBytes: Buffer.from('hello-binary').length,
      mediaStatus: 'ready',
    });

    expect(f.emit).toHaveBeenCalledOnce();
    expect(f.emit.mock.calls[0]?.[0]).toMatchObject({
      conversationId: 'cv1',
      messageId: 'm1',
    });
    expect(f.emitFailed).not.toHaveBeenCalled();
  });
});

describe('runMediaPipeline — retry de download', () => {
  it('falha transitória é retentada e conclui (ready + media_ready)', async () => {
    let calls = 0;
    const bytes = Buffer.from('recovered-binary');
    const f = fakes({
      objectExists: false,
      bytes: async () => {
        calls += 1;
        if (calls === 1) throw new MetaError('5xx', { httpStatus: 503, retryable: true });
        return bytes;
      },
    });

    const res = await runMediaPipeline(makeJob(), f.deps, logger);

    expect(calls).toBe(2);
    expect(res.outcome).toBe('done');
    expect(f.update.mock.calls[0]?.[0]).toMatchObject({ mediaStatus: 'ready' });
    expect(f.emit).toHaveBeenCalledOnce();
    expect(f.emitFailed).not.toHaveBeenCalled();
  });

  it('URL expirada re-resolve fresca e baixa (re-invocação do adapter)', async () => {
    let calls = 0;
    const bytes = Buffer.from('fresh-url-binary');
    const f = fakes({
      objectExists: false,
      bytes: async () => {
        calls += 1;
        // 1ª: URL temporária expirada (404, não-retryável). 2ª: re-resolveu.
        if (calls === 1) throw new MetaError('expirada', { httpStatus: 404, retryable: false });
        return bytes;
      },
    });

    const res = await runMediaPipeline(makeJob(), f.deps, logger);

    expect(calls).toBe(2);
    expect(res.outcome).toBe('done');
    expect(f.update.mock.calls[0]?.[0]).toMatchObject({ mediaStatus: 'ready' });
    expect(f.emitFailed).not.toHaveBeenCalled();
  });

  it('impossível após retries → failed + media_failed', async () => {
    const f = fakes({
      bytes: async () => {
        throw new MetaError('expirada', { httpStatus: 404, retryable: false });
      },
    });

    const res = await runMediaPipeline(makeJob(), f.deps, logger);

    expect(res).toEqual({ outcome: 'failed', reason: 'media_unavailable' });
    // Esgotou as 3 tentativas in-process.
    expect((f.deps.channels.resolve as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(f.download).toHaveBeenCalledTimes(3);
    expect(f.markStatus).toHaveBeenCalledWith(WS, 'm1', 'failed');
    expect(f.emitFailed).toHaveBeenCalledOnce();
    expect(f.emitFailed.mock.calls[0]?.[0]).toMatchObject({
      conversationId: 'cv1',
      messageId: 'm1',
      reason: 'media_unavailable',
    });
    expect(f.update).not.toHaveBeenCalled();
  });
});

describe('runMediaPipeline — dedup por conteúdo', () => {
  it('reaproveita a key existente e NÃO re-sobe', async () => {
    const bytes = Buffer.from('dup-binary');
    const sha = sha256Hex(bytes);
    const existingKey = `${WS}/2025/01/01/old-uuid.jpg`;
    const f = fakes({ bytes, keyBySha: existingKey, objectExists: true });

    const res = await runMediaPipeline(makeJob(), f.deps, logger);

    expect(res.outcome).toBe('done');
    if (res.outcome === 'done') expect(res.deduped).toBe(true);
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.update.mock.calls[0]?.[0]).toMatchObject({
      mediaKey: existingKey,
      mediaSha256: sha,
      mediaStatus: 'ready',
    });
    expect(f.emit).toHaveBeenCalledOnce();
  });

  it('re-sobe se a key registrada sumiu do storage', async () => {
    const f = fakes({ keyBySha: 'ghost-key', objectExists: false });
    const res = await runMediaPipeline(makeJob(), f.deps, logger);
    expect(res.outcome).toBe('done');
    if (res.outcome === 'done') expect(res.deduped).toBe(false);
    expect(f.upload).toHaveBeenCalledOnce();
  });
});

describe('runMediaPipeline — skips (conteúdo morto, sem throw)', () => {
  it('canal não resolvido', async () => {
    const f = fakes({ resolved: null });
    const res = await runMediaPipeline(makeJob(), f.deps, logger);
    expect(res).toEqual({ outcome: 'skipped', reason: 'channel_unresolved' });
    expect(f.update).not.toHaveBeenCalled();
  });

  it('mensagem-alvo inexistente', async () => {
    const f = fakes({ target: null });
    const res = await runMediaPipeline(makeJob(), f.deps, logger);
    expect(res).toEqual({ outcome: 'skipped', reason: 'message_not_found' });
  });

  it('mensagem já ingerida com o mesmo sha (no-op idempotente, restaura ready)', async () => {
    const bytes = Buffer.from('same');
    const sha = sha256Hex(bytes);
    const f = fakes({ bytes, target: { messageId: 'm1', conversationId: 'cv1', existingSha256: sha } });
    const res = await runMediaPipeline(makeJob(), f.deps, logger);
    expect(res).toEqual({ outcome: 'skipped', reason: 'already_ingested' });
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.emit).not.toHaveBeenCalled();
    // downloading transitório é restaurado para ready (sem re-download).
    expect(f.markStatus).toHaveBeenCalledWith(WS, 'm1', 'ready');
  });
});

describe('runMediaPipeline — falhas terminais (failed + media_failed)', () => {
  it('binário vazio → failed', async () => {
    const f = fakes({ bytes: Buffer.alloc(0) });
    const res = await runMediaPipeline(makeJob(), f.deps, logger);
    expect(res).toEqual({ outcome: 'failed', reason: 'empty_media' });
    expect(f.markStatus).toHaveBeenCalledWith(WS, 'm1', 'failed');
    expect(f.emitFailed).toHaveBeenCalledOnce();
  });
});

describe('runMediaPipeline — infra propaga (nack→DLX)', () => {
  it('erro de download retryável persistente propaga (malha DLX/retry)', async () => {
    const f = fakes({
      bytes: async () => {
        throw new MetaError('5xx', { httpStatus: 503, retryable: true });
      },
    });
    await expect(runMediaPipeline(makeJob(), f.deps, logger)).rejects.toThrow();
    // 3 tentativas in-process antes de re-lançar para a malha MQ.
    expect(f.download).toHaveBeenCalledTimes(3);
    // Erro transitório NÃO marca failed (status fica downloading; MQ reprocessa).
    expect(f.emitFailed).not.toHaveBeenCalled();
    expect(f.markStatus).not.toHaveBeenCalledWith(WS, 'm1', 'failed');
  });

  it('falha de storage propaga', async () => {
    const f = fakes({ objectExists: false });
    (f.deps.storage.upload as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('R2 down'));
    await expect(runMediaPipeline(makeJob(), f.deps, logger)).rejects.toThrow('R2 down');
  });
});

describe('handleMediaEnvelope', () => {
  function envelope(payload: unknown): Envelope {
    return {
      id: '00000000-0000-0000-0000-000000000001',
      type: 'inbound.media.requested',
      workspaceId: '00000000-0000-0000-0000-0000000000ff',
      ts: Date.now(),
      payload,
    };
  }

  it('payload inválido → null (ack silencioso, sem throw)', async () => {
    const f = fakes();
    const res = await handleMediaEnvelope(envelope({ nope: true }), { deps: f.deps, logger });
    expect(res).toBeNull();
    expect(f.update).not.toHaveBeenCalled();
  });

  it('payload válido → roda o pipeline', async () => {
    const f = fakes({ objectExists: false });
    const res = await handleMediaEnvelope(
      envelope({
        provider: 'meta_whatsapp',
        externalId: 'wamid.ABC',
        mediaRef: { refOrUrl: 'media-id-123', mimeType: 'image/jpeg' },
        routing: { phoneNumberId: 'pn1' },
      }),
      { deps: f.deps, logger },
    );
    expect(res?.outcome).toBe('done');
    expect(f.emit).toHaveBeenCalledOnce();
  });
});
