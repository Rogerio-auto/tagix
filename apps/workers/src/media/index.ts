/**
 * Worker de mídia (F1-S10) — barrel.
 *
 * Consome `hm.q.media`: valida o `Envelope` → parse do `MediaJob` → download via
 * adapter → SHA-256 → dedup → upload R2 (`{wsId}/{y}/{m}/{d}/{uuid}.{ext}`) →
 * update `messages.media_*` (`@hm/db` + `withWorkspace`, RLS) → emite
 * `message:media_ready` (room `conversation:{id}`).
 *
 * Diferente de inbound/outbound, a persistência do UPDATE é direta via `@hm/db`
 * (o pacote agora depende dele) — sem MQ persist consumer. Todo IO fica atrás
 * de portas injetáveis (testável sem RabbitMQ/DB/HTTP).
 */
export {
  startMediaWorker,
  handleMediaEnvelope,
  createMediaDeps,
  MEDIA_QUEUE,
  MEDIA_PREFETCH,
  STORAGE_PARK_DELAY_MS,
  STORAGE_PARK_MAX_AGE_MS,
  STORAGE_PARKS_HEADER,
  processMediaDelivery,
  parkMediaJob,
  type MediaWorkerOptions,
  type MediaWorkerHandle,
} from './worker';

export {
  runMediaPipeline,
  buildMediaKey,
  type MediaPipelineResult,
  type MediaSkipReason,
  type MediaFailureReason,
} from './pipeline';

export {
  parseMediaJob,
  mediaJobSchema,
  type MediaJob,
  type MediaJobRoutingHints,
} from './job';

export { sha256Hex, deriveExtension, effectiveMime } from './hash';

export {
  DbMediaChannelResolver,
  DbMediaPersistence,
  StorageMediaPort,
  MqMediaSocketEmit,
  SOCKET_RELAY_QUEUE,
  MEDIA_FAILURE_META,
  MEDIA_JOB_META,
  MEDIA_REPROCESS_META,
  type AdapterFactory,
} from './adapters';

export { defaultMediaRetry, TERMINAL_MEDIA_FAILURES } from './ports';
export { promMediaMetrics } from './metrics';
export {
  reprocessMedia,
  providerRecoveryWindowDays,
  type ReprocessOptions,
  type ReprocessReport,
} from './reprocess';

export type {
  MediaDeps,
  MediaChannelResolver,
  ResolvedMediaChannel,
  MediaStoragePort,
  MediaUploadInput,
  MediaPersistencePort,
  MediaMessageTarget,
  MediaPersistInput,
  MediaSocketPort,
  MediaReadyEmit,
  MediaFailedEmit,
  MediaStatus,
  MediaRetryConfig,
  MediaFailureInput,
  MediaMetricsPort,
  MediaAttemptContext,
  StoredMediaJob,
} from './ports';
