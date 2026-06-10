/**
 * @hm/workers — 5 workers especializados + scheduler in-process.
 *
 * Cada worker consome uma fila RabbitMQ dedicada (INFRASTRUCTURE.md). As
 * implementações entram nas fases de canal/campanha/flow; aqui fica o registro
 * tipado dos workers e o ponto de inicialização (`dev:all` sobe todos).
 */

export const WORKERS = [
  'inbound',
  'outbound',
  'media',
  'campaigns',
  'flows',
] as const;

export type WorkerName = (typeof WORKERS)[number];

export interface WorkerHandle {
  readonly name: WorkerName;
  start(): Promise<void>;
  stop(): Promise<void>;
}

// --- Lock distribuído (FIFO por conversa, LIVECHAT.md §3.4) ---
export {
  runWithDistributedLock,
  InMemoryFifoLockStore,
  type LockStore,
  type ReleaseFn,
} from './lock';

// --- Worker outbound (F1-S07) ---
export {
  startOutboundWorker,
  handleOutboundEnvelope,
  parseOutboundJob,
  dispatchOutbound,
  finalizeOutbound,
  MqOutboundPersistence,
  MqSocketEmit,
  OUTBOUND_QUEUE,
  type OutboundJob,
  type OutboundDeps,
  type OutboundWorkerOptions,
  type OutboundWorkerHandle,
} from './outbound/index';

// --- Worker inbound (F1-S04) ---
export {
  startInboundWorker,
  handleInboundEnvelope,
  runInboundPipeline,
  ChannelInboundParser,
  extractRoutingHints,
  MqInboundPersistence,
  MqMediaEnqueue,
  INBOUND_QUEUE,
  INBOUND_PERSIST_TYPE,
  INBOUND_PERSIST_RK,
  INBOUND_MEDIA_TYPE,
  INBOUND_MEDIA_RK,
  type InboundDeps,
  type InboundParserPort,
  type InboundPersistencePort,
  type MediaEnqueuePort,
  type InboundMediaJob,
  type PersistInboundRequest,
  type RoutingHints,
  type ProviderParser,
  type ProviderParsers,
  type InboundPipelineResult,
  type InboundWorkerOptions,
  type InboundWorkerHandle,
} from './inbound/index';

// --- Worker media (F1-S10) ---
export {
  startMediaWorker,
  handleMediaEnvelope,
  createMediaDeps,
  runMediaPipeline,
  buildMediaKey,
  parseMediaJob,
  mediaJobSchema,
  sha256Hex,
  deriveExtension,
  effectiveMime,
  DbMediaChannelResolver,
  DbMediaPersistence,
  StorageMediaPort,
  MqMediaSocketEmit,
  MEDIA_QUEUE,
  MEDIA_PREFETCH,
  SOCKET_RELAY_QUEUE,
  type MediaJob,
  type MediaJobRoutingHints,
  type MediaDeps,
  type MediaChannelResolver,
  type ResolvedMediaChannel,
  type MediaStoragePort,
  type MediaUploadInput,
  type MediaPersistencePort,
  type MediaMessageTarget,
  type MediaPersistInput,
  type MediaSocketPort,
  type MediaReadyEmit,
  type MediaPipelineResult,
  type MediaSkipReason,
  type AdapterFactory,
  type MediaWorkerOptions,
  type MediaWorkerHandle,
} from './media/index';

export const WORKERS_PKG = '@hm/workers' as const;
