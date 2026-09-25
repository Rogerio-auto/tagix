/**
 * Worker de mídia (F1-S10) — composição (LIVECHAT.md §3.3).
 *
 * ```
 * consume hm.q.media → valida Envelope (Zod)
 *   → parseMediaJob (Zod)                         [MediaJob]
 *   → runMediaPipeline (download→sha→dedup→upload→update messages.media_*→emit)
 *   → ack | estaciona (storage negado) | escada de retry → DLQ
 * ```
 *
 * O consumo é próprio (F70-S27), não o `consume` genérico de `@hm/shared/mq`: o
 * worker precisa LER a tentativa corrente (`x-hm-retries`, para logar `error` e marcar
 * a falha só na última) e ESTACIONAR o job quando o storage recusa a credencial — de
 * volta à wait-queue de backoff mais longo, sem incrementar o contador de retentativas.
 * O resto segue a mesma política da fila (`handleConsumeFailure`): conteúdo morto dá
 * `ack`; falha transitória sobe a escada de retry até a DLQ.
 *
 * Concorrência: `prefetch(N)` limita jobs simultâneos por conexão (default 4).
 * Download + upload são IO-bound; um teto baixo protege a VPS de saturar banda
 * de upload pro R2. Sem lock por conversa (mídias são idempotentes por sha e a
 * key é por-objeto — não há ordem a preservar).
 */
import {
  connectMq,
  envelopeSchema,
  ERROR_HEADER,
  handleConsumeFailure,
  NonRetryableError,
  ORIGIN_QUEUE_HEADER,
  QUEUES,
  RETRY_BACKOFF_MS,
  RETRY_COUNT_HEADER,
  retryWaitQueueName,
  type Envelope,
  type MqHandle,
} from '@hm/shared/mq';
import { createStorage } from '@hm/storage';
import type { Logger } from '@hm/logger';
import { parseMediaJob } from './job';
import { runMediaPipeline, type MediaPipelineResult } from './pipeline';
import type { MediaAttemptContext, MediaDeps } from './ports';
import { promMediaMetrics } from './metrics';
import {
  DbMediaChannelResolver,
  DbMediaPersistence,
  StorageMediaPort,
  type AdapterFactory,
  type MqMediaSocketEmit,
} from './adapters';

/** Fila canônica de mídia (`QUEUES.media` = `hm.q.media`). */
export const MEDIA_QUEUE = QUEUES.media;

/** Teto de jobs de mídia simultâneos por conexão (IO-bound: download+upload). */
export const MEDIA_PREFETCH = 4;

/**
 * Espera de um job estacionado por storage negado: o degrau mais longo da escada
 * (30min). A wait-queue já existe (`assertTopology` declara todos os degraus) — nada de
 * topologia nova, e o TTL devolve o job a `hm.q.media` pelo `hm.dlx`.
 */
export const STORAGE_PARK_DELAY_MS: number =
  RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1] ?? 1_800_000;

/**
 * Por quanto tempo um job segue estacionado. Depois disso vai para a DLQ com motivo
 * (`storage_unavailable`): a mensagem já está `failed` com o job guardado, e o
 * `scripts/reprocess-media.ts` recupera o que ainda existir no provedor. Sete dias
 * cobrem um fim de semana prolongado sem ninguém trocar a credencial.
 */
export const STORAGE_PARK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Quantas vezes o job já foi estacionado (diagnóstico; não conta como retentativa). */
export const STORAGE_PARKS_HEADER = 'x-hm-storage-parks';

/** Canal AMQP derivado de `@hm/shared/mq` (sem dep direta de `amqplib`). */
type MqChannel = MqHandle['channel'];
/** Entrega da fila (o `ConsumeMessage` do amqplib), derivada do próprio canal. */
type ConsumeMessage = NonNullable<Parameters<Parameters<MqChannel['consume']>[1]>[0]>;

export interface MediaWorkerOptions {
  readonly deps: MediaDeps;
  readonly logger: Logger;
  /** Override do teto de concorrência (default `MEDIA_PREFETCH`). */
  readonly prefetch?: number;
}

/**
 * Monta as dependências default a partir da infra real: resolver DB-backed
 * (canal+token), storage `@hm/storage` (R2/local pela env), persistência
 * `@hm/db`+RLS, socket via fila de relay e métricas no `/metrics` dos workers.
 */
export function createMediaDeps(
  socketChannel: MqMediaSocketEmit,
  adapterFactory: AdapterFactory,
): MediaDeps {
  return {
    channels: new DbMediaChannelResolver(adapterFactory),
    storage: new StorageMediaPort(createStorage()),
    persistence: new DbMediaPersistence(),
    socket: socketChannel,
    metrics: promMediaMetrics,
  };
}

/**
 * Processa um único envelope (testável sem RabbitMQ). Payload inválido loga-warn e
 * retorna sem lançar (ack). Lança só em falha transitória dentro do pipeline.
 */
export async function handleMediaEnvelope(
  envelope: Envelope,
  options: MediaWorkerOptions,
  ctx?: MediaAttemptContext,
): Promise<MediaPipelineResult | null> {
  const { deps, logger } = options;
  const parsed = parseMediaJobSafe(envelope, logger);
  if (parsed === null) return null;
  return runMediaPipeline(parsed, deps, logger, ctx);
}

/** `safeParse` do payload — payload morto é descartado (ack), não lançado. */
function parseMediaJobSafe(envelope: Envelope, logger: Logger) {
  try {
    return parseMediaJob(envelope.payload);
  } catch {
    logger.warn('media: payload de envelope inválido — descartado', {
      envelopeId: envelope.id,
      type: envelope.type,
    });
    return null;
  }
}

/** Contador numérico de um header (`x-hm-retries`, `x-hm-storage-parks`). */
function readCount(msg: ConsumeMessage, header: string): number {
  const raw: unknown = msg.properties.headers?.[header];
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
}

/**
 * Estaciona o job: republica na wait-queue de backoff mais longo com o MESMO
 * `x-hm-retries` (não gasta retentativa) e dá `ack` na original — a cópia é o que
 * garante a durabilidade, igual a `handleConsumeFailure`. Passado o teto de idade,
 * desiste para a DLQ com motivo.
 */
export function parkMediaJob(
  channel: MqChannel,
  msg: ConsumeMessage,
  envelope: Envelope,
  code: string,
  logger: Logger,
  metrics: MediaDeps['metrics'],
  now: number = Date.now(),
): 'parked' | 'dead_lettered' {
  const parks = readCount(msg, STORAGE_PARKS_HEADER);
  const ageMs = now - envelope.ts;
  if (ageMs > STORAGE_PARK_MAX_AGE_MS) {
    logger.error('media: storage segue recusando há dias — job enviado à DLQ para reprocessamento', {
      envelopeId: envelope.id,
      storageCode: code,
      parks,
      ageHours: Math.round(ageMs / 3_600_000),
    });
    handleConsumeFailure({
      channel,
      queue: MEDIA_QUEUE,
      msg,
      error: new NonRetryableError(`storage_unavailable: ${code}`),
      policy: {},
      logger,
    });
    return 'dead_lettered';
  }
  channel.sendToQueue(retryWaitQueueName(MEDIA_QUEUE, STORAGE_PARK_DELAY_MS), msg.content, {
    persistent: true,
    contentType: msg.properties.contentType ?? 'application/json',
    headers: {
      ...msg.properties.headers,
      [RETRY_COUNT_HEADER]: readCount(msg, RETRY_COUNT_HEADER),
      [ORIGIN_QUEUE_HEADER]: MEDIA_QUEUE,
      [ERROR_HEADER]: `StorageError: ${code}`,
      [STORAGE_PARKS_HEADER]: parks + 1,
    },
  });
  channel.ack(msg);
  metrics?.jobParked();
  logger.warn('media: job estacionado até o storage aceitar a credencial', {
    envelopeId: envelope.id,
    storageCode: code,
    parks: parks + 1,
    delayMs: STORAGE_PARK_DELAY_MS,
  });
  return 'parked';
}

/** Processa uma entrega da fila: ack, estaciona ou devolve à escada de retry. */
export async function processMediaDelivery(
  channel: MqChannel,
  msg: ConsumeMessage,
  options: MediaWorkerOptions,
): Promise<void> {
  const { logger } = options;
  let envelope: Envelope;
  try {
    envelope = envelopeSchema.parse(JSON.parse(msg.content.toString()));
  } catch (err: unknown) {
    // Envelope corrompido: direto para a DLQ com motivo (mesma regra do `consume`).
    handleConsumeFailure({ channel, queue: MEDIA_QUEUE, msg, error: err, policy: {}, logger });
    return;
  }
  const ctx: MediaAttemptContext = {
    attempt: readCount(msg, RETRY_COUNT_HEADER),
    maxRetries: RETRY_BACKOFF_MS.length,
  };
  try {
    const result = await handleMediaEnvelope(envelope, options, ctx);
    if (result?.outcome === 'deferred') {
      parkMediaJob(channel, msg, envelope, result.code, logger, options.deps.metrics);
      return;
    }
    channel.ack(msg);
  } catch (err: unknown) {
    handleConsumeFailure({ channel, queue: MEDIA_QUEUE, msg, error: err, policy: {}, logger });
  }
}

export interface MediaWorkerHandle {
  stop(): Promise<void>;
}

/**
 * Inicia o consumer de `hm.q.media`. Conecta ao RabbitMQ, garante a fila, fixa o
 * teto de concorrência e registra o handler. O `channel.consume` passa pela fachada
 * resiliente de `connectMq`: é re-registrado sozinho numa reconexão.
 */
export async function startMediaWorker(options: MediaWorkerOptions): Promise<MediaWorkerHandle> {
  const { logger } = options;
  const { connection, channel } = await connectMq();
  await channel.assertQueue(MEDIA_QUEUE, { durable: true });
  await channel.prefetch(options.prefetch ?? MEDIA_PREFETCH);

  await channel.consume(MEDIA_QUEUE, (msg) => {
    if (!msg) return;
    void processMediaDelivery(channel, msg, options).catch((err: unknown) => {
      // Só chega aqui se o próprio ack/republish falhar (canal caído): a mensagem não
      // foi confirmada e o broker a reentrega na reconexão.
      logger.error('media: falha ao confirmar entrega', {
        errorName: err instanceof Error ? err.name : typeof err,
      });
    });
  });

  logger.info('media worker iniciado', {
    queue: MEDIA_QUEUE,
    prefetch: options.prefetch ?? MEDIA_PREFETCH,
  });

  return {
    async stop(): Promise<void> {
      await channel.close();
      await connection.close();
      logger.info('media worker parado', { queue: MEDIA_QUEUE });
    },
  };
}
