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
  type MediaWorkerOptions,
  type MediaWorkerHandle,
} from './worker';

export {
  runMediaPipeline,
  buildMediaKey,
  type MediaPipelineResult,
  type MediaSkipReason,
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
  type AdapterFactory,
} from './adapters';

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
} from './ports';
