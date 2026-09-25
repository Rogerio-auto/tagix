/**
 * Worker inbound (F1-S04 → refatorado em F1-S26) — barrel.
 *
 * Consome `hm.q.inbound`: valida o `Envelope` → parse por provider (WA/WAHA
 * reais, IG placeholder logged-warn) → enfileira mídia → **persiste in-process**
 * via `@hm/db`+RLS (dedup→contact→conversation→message→last→cache) → emite
 * `message:new` → status (S20) → flow (ai_mode='on', STUB).
 */
export {
  startInboundWorker,
  handleInboundEnvelope,
  createInboundDeps,
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
  InboundMediaJob,
  PersistInboundRequest,
  PersistInboundResult,
  RoutingHints,
} from './ports';

export { INBOUND_MEDIA_TYPE, inboundMediaJobOutbox } from './mq-ports';

export {
  DbInboundPersistence,
  DbInboundChannelResolver,
  MqInboundSocketEmit,
  inboundAgentRunJob,
  INBOUND_FLOW_TYPE,
  FLOWS_QUEUE,
  SOCKET_RELAY_QUEUE,
  type InboundChannelResolver,
  type ResolvedInboundChannel,
  type InboundSocketPort,
  type InboundMessageNewEmit,
} from './db-ports';

// F70-S07 — origem/atribuição, ecos do Instagram e trava da IA no handoff de campanha.
export {
  applyOriginTag,
  classifyInboundConversation,
  firstAdReferral,
  loadOriginPrefillMarkers,
  recordFirstTouchAttribution,
} from './origin';
export { createInstagramEchoStep, type InstagramEchoPort } from './instagram-echoes';
export { gateCampaignAiHandoff, type AiActivationPort } from './ai-gate';
