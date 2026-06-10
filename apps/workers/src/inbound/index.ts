/**
 * Worker inbound (F1-S04) — barrel.
 *
 * Consome `hm.q.inbound`: valida o `Envelope` → parse por provider (WA/WAHA
 * reais, IG placeholder logged-warn) → enfileira mídia → publica
 * `inbound.persist.requested` (DB-owner aplica dedup→contact→conversation→
 * persist→last→cache→socket→agent/flow).
 */
export {
  startInboundWorker,
  handleInboundEnvelope,
  INBOUND_QUEUE,
  UNRESOLVED_WORKSPACE_ID,
  type InboundWorkerOptions,
  type InboundWorkerHandle,
} from './worker';

export {
  runInboundPipeline,
  type InboundPipelineResult,
} from './pipeline';

export {
  ChannelInboundParser,
  extractRoutingHints,
  type ProviderParser,
  type ProviderParsers,
} from './parse';

export type {
  InboundDeps,
  InboundParserPort,
  InboundPersistencePort,
  MediaEnqueuePort,
  InboundMediaJob,
  PersistInboundRequest,
  RoutingHints,
} from './ports';

export {
  MqInboundPersistence,
  MqMediaEnqueue,
  INBOUND_PERSIST_TYPE,
  INBOUND_PERSIST_RK,
  INBOUND_MEDIA_TYPE,
  INBOUND_MEDIA_RK,
} from './mq-ports';
