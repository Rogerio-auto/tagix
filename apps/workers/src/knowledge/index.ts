/**
 * Barrel + composição do worker de ingestão de KB (F3-S03).
 *
 * `createKbIngestDeps` monta as dependências default a partir da infra real
 * (store DIRETO `@hm/db`+RLS, embed client HTTP ao runtime). Consumido pelo
 * bootstrap de workers (registrado pelo orchestrator no composition root).
 */
import type { Logger } from '@hm/logger';
import { embedConfigFromEnv, HttpEmbedClient } from './embed-client';
import { DbKbIngestStore } from './store';
import type { KbIngestDeps } from './worker';

/** Deps default: store Drizzle + cliente HTTP de embed (config do ambiente). */
export function createKbIngestDeps(logger: Logger): KbIngestDeps {
  return {
    store: new DbKbIngestStore(),
    embedClient: new HttpEmbedClient(embedConfigFromEnv()),
    logger,
  };
}

export { chunkDocument, estimateTokens, type DocumentChunk } from './chunker';
export {
  embedConfigFromEnv,
  EmbedClientError,
  EmbedUpstreamError,
  HttpEmbedClient,
  EMBEDDING_DIM,
  type EmbedClient,
  type EmbedConfig,
  type EmbedResult,
} from './embed-client';
export { DbKbIngestStore, type EmbeddedChunk, type KbIngestStore } from './store';
export {
  handleKbIngestEnvelope,
  startKbIngestWorker,
  KB_INGEST_QUEUE,
  type KbIngestDeps,
  type KbIngestWorkerHandle,
  type KbIngestWorkerOptions,
} from './worker';
