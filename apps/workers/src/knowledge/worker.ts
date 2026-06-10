/**
 * Worker de ingestão da Knowledge Base (F3-S03).
 *
 * Consome `kb.document.ingest` (publicada por F3-S04 em `hm.q.kb_ingest`) e roda
 * o pipeline:
 *
 * ```
 * consume hm.q.kb_ingest → valida Envelope (Zod, em `consume`)
 *   → parseKbDocumentIngest (Zod do payload, contrato de @hm/shared)
 *   → loadDocument → chunkDocument → embed (/internal/embed) → replaceChunks → markActive
 *   → ack/nack
 * ```
 *
 * Idempotência: `replaceChunks` apaga+reinsere — re-delivery RabbitMQ e reprocesso
 * (`reason:'reprocess'`) são seguros. Falha transitória do embed (`EmbedUpstreamError`)
 * é RE-LANÇADA para o `consume` converter em nack→DLX (a convenção F0-S13);
 * falha de conteúdo (payload inválido, doc inexistente, embed 4xx) é logada e
 * ack'd (reprocessar conteúdo imutável não ajuda). O doc só vira `active` no
 * caminho feliz — falha o deixa `draft` (não-indexado), sem chunks órfãos.
 */
import {
  connectMq,
  consume,
  parseKbDocumentIngest,
  QUEUES,
  type Envelope,
  type MqHandle,
} from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import { chunkDocument } from './chunker';
import { EmbedClientError, EmbedUpstreamError, type EmbedClient } from './embed-client';
import type { EmbeddedChunk, KbIngestStore } from './store';

type MqChannel = MqHandle['channel'];

/** Fila consumida (declarada na topologia por F3-S04). */
export const KB_INGEST_QUEUE = QUEUES.kbIngest;

export interface KbIngestDeps {
  readonly store: KbIngestStore;
  readonly embedClient: EmbedClient;
  readonly logger: Logger;
}

/**
 * Processa um único envelope (testável sem RabbitMQ). Re-lança apenas em falha
 * transitória de embed (-> nack→DLX). Conteúdo inválido não lança.
 */
export async function handleKbIngestEnvelope(
  envelope: Envelope,
  deps: KbIngestDeps,
): Promise<void> {
  const { store, embedClient, logger } = deps;

  const parsed = (() => {
    try {
      return parseKbDocumentIngest(envelope.payload);
    } catch {
      return null;
    }
  })();
  if (parsed === null) {
    logger.warn('kb-ingest: payload inválido — descartado', { envelopeId: envelope.id });
    return;
  }

  const { workspaceId, documentId, reason } = parsed;

  const doc = await store.loadDocument(workspaceId, documentId);
  if (doc === null) {
    logger.warn('kb-ingest: documento inexistente — descartado', { documentId });
    return;
  }

  const chunks = chunkDocument(doc.rawContent);
  if (chunks.length === 0) {
    // Documento sem conteúdo indexável: limpa chunks e ativa (estado consistente).
    await store.replaceChunks(workspaceId, documentId, []);
    await store.markActive(workspaceId, documentId);
    logger.info('kb-ingest: documento sem chunks — ativado vazio', { documentId, reason });
    return;
  }

  let embedded: EmbeddedChunk[];
  try {
    const result = await embedClient.embed(
      workspaceId,
      chunks.map((c) => c.content),
    );
    if (result.embeddings.length !== chunks.length) {
      throw new EmbedClientError('contagem de embeddings divergente dos chunks');
    }
    embedded = chunks.map((c, i) => ({ ...c, embedding: result.embeddings[i]! }));
  } catch (err) {
    if (err instanceof EmbedUpstreamError) {
      // Transitório: re-lança para nack→DLX (não trava a fila; o broker reentrega).
      logger.warn('kb-ingest: embed indisponível — nack→DLX', { documentId });
      throw err;
    }
    // Falha de conteúdo/contrato: não adianta reprocessar. Doc permanece draft.
    logger.error('kb-ingest: falha de embed não-retriável — doc fica draft', {
      documentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Persiste (idempotente) + ativa. Falha de DB aqui propaga -> nack→DLX.
  await store.replaceChunks(workspaceId, documentId, embedded);
  await store.markActive(workspaceId, documentId);
  logger.info('kb-ingest: documento indexado', {
    documentId,
    reason,
    chunks: embedded.length,
  });
}

export interface KbIngestWorkerOptions {
  readonly deps: KbIngestDeps;
  readonly logger: Logger;
}

export interface KbIngestWorkerHandle {
  stop(): Promise<void>;
}

/** Inicia o consumer de `hm.q.kb_ingest`. */
export async function startKbIngestWorker(
  options: KbIngestWorkerOptions,
): Promise<KbIngestWorkerHandle> {
  const { deps, logger } = options;
  const { connection, channel } = await connectMq();
  await channel.assertQueue(KB_INGEST_QUEUE, { durable: true });
  await channel.prefetch(4);

  await consume(channel, KB_INGEST_QUEUE, async (envelope) => {
    await handleKbIngestEnvelope(envelope, deps);
  });

  logger.info('kb-ingest worker iniciado', { queue: KB_INGEST_QUEUE });

  return {
    async stop(): Promise<void> {
      await channel.close();
      await connection.close();
      logger.info('kb-ingest worker parado', { queue: KB_INGEST_QUEUE });
    },
  };
}

/** Canal AMQP exportado para composição (não usado internamente além do consumer). */
export type { MqChannel };
