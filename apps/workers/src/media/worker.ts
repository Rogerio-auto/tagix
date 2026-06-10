/**
 * Worker de mídia (F1-S10) — composição (LIVECHAT.md §3.3).
 *
 * ```
 * consume hm.q.media → valida Envelope (Zod, em `consume`)
 *   → parseMediaJob (Zod)                         [MediaJob]
 *   → runMediaPipeline (download→sha→dedup→upload→update messages.media_*→emit)
 *   → ack/nack
 * ```
 *
 * `consume` de `@hm/shared/mq` valida o `Envelope`, faz `ack` em sucesso e
 * `nack(requeue=false)→DLX` se o handler lançar. Conteúdo morto (canal não
 * resolvido, mensagem inexistente, mídia indisponível) NÃO lança — o pipeline
 * loga-warn e retorna `skipped`, e o job é ack'd (reprocessar payload imutável
 * não ajuda). Só infra (storage/DB/socket/rede) propaga → nack → DLX.
 *
 * Concorrência: `prefetch(N)` limita jobs simultâneos por conexão (default 4).
 * Download + upload são IO-bound; um teto baixo protege a VPS de saturar banda
 * de upload pro R2. Sem lock por conversa (mídias são idempotentes por sha e a
 * key é por-objeto — não há ordem a preservar).
 */
import { connectMq, consume, QUEUES, type Envelope } from '@hm/shared/mq';
import { createStorage } from '@hm/storage';
import type { Logger } from '@hm/logger';
import { parseMediaJob } from './job';
import { runMediaPipeline, type MediaPipelineResult } from './pipeline';
import type { MediaDeps } from './ports';
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

export interface MediaWorkerOptions {
  readonly deps: MediaDeps;
  readonly logger: Logger;
  /** Override do teto de concorrência (default `MEDIA_PREFETCH`). */
  readonly prefetch?: number;
}

/**
 * Monta as dependências default a partir da infra real: resolver DB-backed
 * (canal+token), storage `@hm/storage` (R2/local pela env), persistência
 * `@hm/db`+RLS e socket via fila de relay. A fábrica de adapter é injetada
 * (config de provider é composição) — ver `adapters.ts`.
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
  };
}

/**
 * Processa um único envelope (testável sem RabbitMQ). Payload inválido loga-warn
 * e retorna sem lançar (ack). Lança só em infra dentro do pipeline → nack.
 */
export async function handleMediaEnvelope(
  envelope: Envelope,
  options: MediaWorkerOptions,
): Promise<MediaPipelineResult | null> {
  const { deps, logger } = options;
  const parsed = parseMediaJobSafe(envelope, logger);
  if (parsed === null) return null;
  return runMediaPipeline(parsed, deps, logger);
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

export interface MediaWorkerHandle {
  stop(): Promise<void>;
}

/**
 * Inicia o consumer de `hm.q.media`. Conecta ao RabbitMQ, garante a fila, fixa o
 * teto de concorrência e registra o handler. Retorna um handle para parada limpa.
 */
export async function startMediaWorker(options: MediaWorkerOptions): Promise<MediaWorkerHandle> {
  const { logger } = options;
  const { connection, channel } = await connectMq();
  await channel.assertQueue(MEDIA_QUEUE, { durable: true });
  await channel.prefetch(options.prefetch ?? MEDIA_PREFETCH);

  await consume(channel, MEDIA_QUEUE, async (envelope) => {
    await handleMediaEnvelope(envelope, options);
  });

  logger.info('media worker iniciado', { queue: MEDIA_QUEUE, prefetch: options.prefetch ?? MEDIA_PREFETCH });

  return {
    async stop(): Promise<void> {
      await channel.close();
      await connection.close();
      logger.info('media worker parado', { queue: MEDIA_QUEUE });
    },
  };
}
