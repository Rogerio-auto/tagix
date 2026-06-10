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

// --- Worker outbound (F1-S07, persistência direta @hm/db em F1-S26) ---
export {
  startOutboundWorker,
  handleOutboundEnvelope,
  createOutboundDeps,
  parseOutboundJob,
  dispatchOutbound,
  finalizeOutbound,
  MqOutboundPersistence,
  MqSocketEmit,
  DbChannelResolver,
  DbOutboundPersistence,
  toChannelSnapshot,
  OUTBOUND_QUEUE,
  type OutboundJob,
  type OutboundDeps,
  type OutboundWorkerOptions,
  type OutboundWorkerHandle,
  type ChannelAdapterFactory,
} from './outbound/index';

// --- Worker inbound (F1-S04, persistência direta @hm/db em F1-S26) ---
export {
  startInboundWorker,
  handleInboundEnvelope,
  createInboundDeps,
  runInboundPipeline,
  ChannelInboundParser,
  extractRoutingHints,
  MqMediaEnqueue,
  DbInboundPersistence,
  DbInboundChannelResolver,
  MqInboundSocketEmit,
  MqInboundFlowEnqueue,
  INBOUND_QUEUE,
  INBOUND_MEDIA_TYPE,
  INBOUND_MEDIA_RK,
  INBOUND_FLOW_TYPE,
  type InboundDeps,
  type InboundParserPort,
  type InboundPersistencePort,
  type MediaEnqueuePort,
  type InboundMediaJob,
  type PersistInboundRequest,
  type PersistInboundResult,
  type RoutingHints,
  type ProviderParser,
  type ProviderParsers,
  type InboundPipelineResult,
  type InboundWorkerOptions,
  type InboundWorkerHandle,
  type InboundChannelResolver,
  type ResolvedInboundChannel,
  type InboundSocketPort,
  type InboundFlowEnqueuePort,
  type InboundFlowTrigger,
} from './inbound/index';

// --- Status (F1-S20) + presença (F1-S21) wiring ---
export {
  handleStatusEvent,
  createStatusDeps,
  type StatusDeps,
  type StatusEventInput,
  type StatusHandleResult,
} from './inbound/status';

// --- Bootstrap / composition root (F1-S26) ---
export {
  startWorkers,
  main,
  createAdapterFactory,
  adapterFactoryByChannel,
  AdapterUnavailableError,
  type BootstrapOptions,
  type WorkersBootstrapHandle,
  type AdapterFactoryOptions,
} from './bootstrap/index';

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
