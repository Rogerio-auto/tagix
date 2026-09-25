/**
 * F70-S27 — falha de storage visível no worker de mídia.
 *
 * O incidente de 25/09: o R2 recusou a credencial (`AccessDenied`), os jobs gastaram a
 * escada de retry inteira em silêncio e morreram na DLQ, e a tela ficou "carregando"
 * para sempre. Aqui se trava o comportamento novo, com portas falsas e um canal AMQP
 * falso (sem RabbitMQ, DB nem HTTP):
 *  - storage de CONFIGURAÇÃO → `warn` estruturado sem segredo, contador sobe, mensagem
 *    `failed` = `storage_unavailable`, job ESTACIONADO sem gastar retentativa;
 *  - storage TRANSITÓRIO → `warn` e escada de retry; na última tentativa, `error` e
 *    mensagem `failed` = `storage_error`, e o job vai para a DLQ;
 *  - estacionado há dias → DLQ com motivo.
 */
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import type { Channel, IChannelAdapter } from '@hm/channels';
import {
  DLQ_REASON_HEADER,
  RETRY_BACKOFF_MS,
  RETRY_COUNT_HEADER,
  type Envelope,
  type MqHandle,
} from '@hm/shared/mq';
import { StorageError } from '@hm/storage';
import { runMediaPipeline } from './pipeline';
import {
  MEDIA_QUEUE,
  STORAGE_PARK_DELAY_MS,
  STORAGE_PARK_MAX_AGE_MS,
  STORAGE_PARKS_HEADER,
  processMediaDelivery,
} from './worker';
import type { MediaDeps, MediaMessageTarget, MediaStoragePort } from './ports';

const WS = '00000000-0000-0000-0000-0000000000aa';
const ACCESS_KEY = 'AKIA_NAO_PODE_APARECER_NO_LOG';
const SIGNED_URL = 'https://conta.r2.cloudflarestorage.com/b/k?X-Amz-Signature=segredo';

function makeLogger() {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn((): typeof logger => logger),
  };
  return logger;
}

const channel: Channel = {
  id: 'ch1',
  workspaceId: WS,
  provider: 'meta_whatsapp',
  accessToken: 'tok',
  phoneNumberId: 'pn1',
};

/** Erro como o AWS SDK entrega: nome AccessDenied e a chave ecoada na mensagem. */
function awsAccessDenied(): Error {
  return Object.assign(new Error(`Access Denied for ${ACCESS_KEY} at ${SIGNED_URL}`), {
    name: 'AccessDenied',
    $metadata: { httpStatusCode: 403 },
  });
}

function deps(opts: {
  upload?: () => Promise<void>;
  target?: Partial<MediaMessageTarget>;
}): MediaDeps & {
  markFailed: ReturnType<typeof vi.fn>;
  emitFailed: ReturnType<typeof vi.fn>;
  metrics: {
    storageFailure: ReturnType<typeof vi.fn>;
    jobParked: ReturnType<typeof vi.fn>;
    mediaFailed: ReturnType<typeof vi.fn>;
  };
} {
  const adapter = {
    downloadMedia: vi.fn(async () => Buffer.from('bytes-da-midia')),
  } as unknown as IChannelAdapter;
  const storage: MediaStoragePort = {
    objectExists: vi.fn(async () => true),
    upload: vi.fn(opts.upload ?? (async () => undefined)),
    publicUrl: vi.fn(async (key: string) => `https://cdn.test/${key}`),
  };
  const markFailed = vi.fn(async () => undefined);
  const emitFailed = vi.fn(async () => undefined);
  const metrics = { storageFailure: vi.fn(), jobParked: vi.fn(), mediaFailed: vi.fn() };
  return {
    channels: { resolve: vi.fn(async () => ({ channel, adapter, workspaceId: WS })) },
    storage,
    persistence: {
      findMessage: vi.fn(async () => ({
        messageId: 'm1',
        conversationId: 'cv1',
        existingSha256: null,
        currentFailureReason: null,
        ...opts.target,
      })),
      findKeyBySha256: vi.fn(async () => null),
      update: vi.fn(async () => undefined),
      markStatus: vi.fn(async () => undefined),
      markFailed,
    },
    socket: { emitMediaReady: vi.fn(async () => undefined), emitMediaFailed: emitFailed },
    retry: { maxAttempts: 1, backoffMs: [], sleep: async () => undefined },
    metrics,
    markFailed,
    emitFailed,
  };
}

const job = {
  provider: 'meta_whatsapp' as const,
  externalId: 'wamid.S27',
  mediaRef: { refOrUrl: 'media-id-1', mimeType: 'audio/ogg' },
  routing: { phoneNumberId: 'pn1' },
};

function allLogText(logger: ReturnType<typeof makeLogger>): string {
  return JSON.stringify([logger.warn.mock.calls, logger.error.mock.calls, logger.info.mock.calls]);
}

describe('pipeline — storage recusou a credencial (configuração)', () => {
  it('warn estruturado sem segredo, contador sobe, failed=storage_unavailable, deferred (não lança)', async () => {
    const d = deps({
      upload: async () => {
        throw StorageError.from(awsAccessDenied(), 'put', 'leadium-production');
      },
    });
    const logger = makeLogger();

    const res = await runMediaPipeline(job, d, logger, { attempt: 0, maxRetries: 5 });

    expect(res).toEqual({ outcome: 'deferred', reason: 'storage_config', code: 'AccessDenied' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('storage recusou a credencial'),
      expect.objectContaining({
        storageCode: 'AccessDenied',
        storageKind: 'config',
        storageOperation: 'put',
        bucket: 'leadium-production',
        messageId: 'm1',
        workspaceId: WS,
      }),
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(d.metrics.storageFailure).toHaveBeenCalledWith('config', 'AccessDenied', 'put');
    expect(d.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'm1',
        reason: 'storage_unavailable',
        code: 'AccessDenied',
        job,
      }),
    );
    expect(d.emitFailed).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'm1', reason: 'storage_unavailable' }),
    );
    // Nada de chave nem URL assinada em log algum.
    const text = allLogText(logger);
    expect(text).not.toContain(ACCESS_KEY);
    expect(text).not.toContain('X-Amz-Signature');
  });

  it('erro cru do SDK (sem embrulho) também é classificado como configuração', async () => {
    const d = deps({ upload: async () => Promise.reject(awsAccessDenied()) });
    const logger = makeLogger();
    const res = await runMediaPipeline(job, d, logger, { attempt: 0, maxRetries: 5 });
    expect(res.outcome).toBe('deferred');
    expect(allLogText(logger)).not.toContain(ACCESS_KEY);
  });

  it('volta de um job já estacionado não reemite media_failed nem conta nova falha de mídia', async () => {
    const d = deps({
      upload: async () => Promise.reject(awsAccessDenied()),
      target: { currentFailureReason: 'storage_unavailable' },
    });
    await runMediaPipeline(job, d, makeLogger(), { attempt: 0, maxRetries: 5 });
    expect(d.emitFailed).not.toHaveBeenCalled();
    expect(d.metrics.mediaFailed).not.toHaveBeenCalled();
    // A recusa em si segue contando: é o sinal do alerta.
    expect(d.metrics.storageFailure).toHaveBeenCalledOnce();
  });
});

describe('pipeline — storage transitório', () => {
  const unavailable = (): Promise<void> =>
    Promise.reject(
      Object.assign(new Error('Service Unavailable'), {
        name: 'ServiceUnavailable',
        $metadata: { httpStatusCode: 503 },
      }),
    );

  it('tentativa intermediária: warn e lança para a escada, sem marcar failed', async () => {
    const d = deps({ upload: unavailable });
    const logger = makeLogger();
    await expect(
      runMediaPipeline(job, d, logger, { attempt: 1, maxRetries: 5 }),
    ).rejects.toThrow('Service Unavailable');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('nova tentativa'),
      expect.objectContaining({ storageKind: 'transient', attempt: 2, maxAttempts: 6 }),
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(d.markFailed).not.toHaveBeenCalled();
    expect(d.metrics.storageFailure).toHaveBeenCalledWith('transient', 'ServiceUnavailable', 'put');
  });

  it('última tentativa: error e failed=storage_error, e ainda lança (DLQ)', async () => {
    const d = deps({ upload: unavailable });
    const logger = makeLogger();
    await expect(runMediaPipeline(job, d, logger, { attempt: 5, maxRetries: 5 })).rejects.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('última tentativa'),
      expect.objectContaining({ storageCode: 'ServiceUnavailable', messageId: 'm1' }),
    );
    expect(d.markFailed).toHaveBeenCalledWith(expect.objectContaining({ reason: 'storage_error' }));
    expect(d.emitFailed).toHaveBeenCalledOnce();
  });
});

// ─── Worker: estacionar sem gastar retentativa ───────────────────────────────

type MqChannel = MqHandle['channel'];
type ConsumeMessage = NonNullable<Parameters<Parameters<MqChannel['consume']>[1]>[0]>;

function fakeMq() {
  const sendToQueue = vi.fn((_q: string, _c: Buffer, _o?: unknown) => true);
  const publish = vi.fn((_e: string, _rk: string, _c: Buffer, _o?: unknown) => true);
  const ack = vi.fn();
  const ch = { sendToQueue, publish, ack, nack: vi.fn() } as unknown as MqChannel;
  return { ch, sendToQueue, publish, ack };
}

function delivery(env: Envelope, headers: Record<string, unknown>): ConsumeMessage {
  return {
    content: Buffer.from(JSON.stringify(env)),
    fields: {},
    properties: { headers, contentType: 'application/json' },
  } as unknown as ConsumeMessage;
}

function envelope(ts: number): Envelope {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    type: 'inbound.media.requested',
    workspaceId: WS,
    ts,
    payload: job,
  };
}

function optionHeaders(o: unknown): Record<string, unknown> {
  const headers: unknown = (o as { headers?: unknown } | undefined)?.headers;
  return (headers ?? {}) as Record<string, unknown>;
}

describe('worker — storage negado estaciona o job', () => {
  it('republica na espera longa com o MESMO x-hm-retries e dá ack (não gasta retentativa)', async () => {
    const d = deps({ upload: async () => Promise.reject(awsAccessDenied()) });
    const mq = fakeMq();
    const logger = makeLogger();

    await processMediaDelivery(
      mq.ch,
      delivery(envelope(Date.now()), { [RETRY_COUNT_HEADER]: 2 }),
      { deps: d, logger },
    );

    expect(mq.sendToQueue).toHaveBeenCalledOnce();
    const [queue, , options] = mq.sendToQueue.mock.calls[0] ?? [];
    expect(queue).toBe(`${MEDIA_QUEUE}.retry.${STORAGE_PARK_DELAY_MS}`);
    expect(STORAGE_PARK_DELAY_MS).toBe(RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
    const headers = optionHeaders(options);
    expect(headers[RETRY_COUNT_HEADER]).toBe(2);
    expect(headers[STORAGE_PARKS_HEADER]).toBe(1);
    expect(String(headers['x-hm-error'])).toBe('StorageError: AccessDenied');
    expect(mq.ack).toHaveBeenCalledOnce();
    expect(mq.publish).not.toHaveBeenCalled(); // nada foi para a DLQ
    expect(d.metrics.jobParked).toHaveBeenCalledOnce();
  });

  it('mesmo esgotadas as retentativas da escada, storage negado segue estacionando', async () => {
    const d = deps({ upload: async () => Promise.reject(awsAccessDenied()) });
    const mq = fakeMq();
    await processMediaDelivery(
      mq.ch,
      delivery(envelope(Date.now()), { [RETRY_COUNT_HEADER]: 5, [STORAGE_PARKS_HEADER]: 3 }),
      { deps: d, logger: makeLogger() },
    );
    expect(mq.publish).not.toHaveBeenCalled();
    expect(optionHeaders(mq.sendToQueue.mock.calls[0]?.[2])[STORAGE_PARKS_HEADER]).toBe(4);
  });

  it('estacionado além do teto de idade → DLQ com motivo, para o reprocessamento', async () => {
    const d = deps({ upload: async () => Promise.reject(awsAccessDenied()) });
    const mq = fakeMq();
    const logger = makeLogger();
    await processMediaDelivery(
      mq.ch,
      delivery(envelope(Date.now() - STORAGE_PARK_MAX_AGE_MS - 60_000), {}),
      { deps: d, logger },
    );
    expect(mq.sendToQueue).not.toHaveBeenCalled();
    expect(mq.publish).toHaveBeenCalledOnce();
    expect(optionHeaders(mq.publish.mock.calls[0]?.[3])[DLQ_REASON_HEADER]).toBe('non_retryable');
    expect(logger.error).toHaveBeenCalled();
  });

  it('transitório na última tentativa → DLQ (escada normal), com a mensagem já failed', async () => {
    const d = deps({
      upload: async () =>
        Promise.reject(Object.assign(new Error('x'), { code: 'ECONNRESET' })),
    });
    const mq = fakeMq();
    await processMediaDelivery(
      mq.ch,
      delivery(envelope(Date.now()), { [RETRY_COUNT_HEADER]: RETRY_BACKOFF_MS.length }),
      { deps: d, logger: makeLogger() },
    );
    expect(mq.publish).toHaveBeenCalledOnce();
    expect(optionHeaders(mq.publish.mock.calls[0]?.[3])[DLQ_REASON_HEADER]).toBe(
      'max_retries_exhausted',
    );
    expect(d.markFailed).toHaveBeenCalledWith(expect.objectContaining({ reason: 'storage_error' }));
  });

  it('transitório no meio da escada → próximo degrau, contador incrementado', async () => {
    const d = deps({
      upload: async () =>
        Promise.reject(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })),
    });
    const mq = fakeMq();
    await processMediaDelivery(
      mq.ch,
      delivery(envelope(Date.now()), { [RETRY_COUNT_HEADER]: 1 }),
      { deps: d, logger: makeLogger() },
    );
    const [queue, , options] = mq.sendToQueue.mock.calls[0] ?? [];
    expect(queue).toBe(`${MEDIA_QUEUE}.retry.${RETRY_BACKOFF_MS[1]}`);
    expect(optionHeaders(options)[RETRY_COUNT_HEADER]).toBe(2);
    expect(d.markFailed).not.toHaveBeenCalled();
  });
});
