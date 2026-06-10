/**
 * Worker outbound (F1-S07) — barrel.
 *
 * Consome `hm.q.outbound`: parse (Zod `OutboundJob`) → lock FIFO por conversa →
 * dispatch (valida `kind ↔ provider`) → adapter → finalize (persist + socket).
 */
export {
  startOutboundWorker,
  handleOutboundEnvelope,
  createOutboundDeps,
  lockKey,
  OUTBOUND_QUEUE,
  OUTBOUND_LOCK_TTL_MS,
  type OutboundWorkerOptions,
  type OutboundWorkerHandle,
} from './worker';

export {
  DbChannelResolver,
  DbOutboundPersistence,
  toChannelSnapshot,
  type ChannelAdapterFactory,
} from './db-ports';

export {
  runPresencePreAction,
  emitContactPresence,
  type ContactPresenceEmitPort,
} from './presence';

export {
  parseOutboundJob,
  outboundJobSchema,
  type OutboundJob,
  type OutboundJobKind,
  type IgMessageTag,
} from './job';

export { dispatchOutbound, type DispatchResult } from './dispatch';
export { finalizeOutbound, statusFromResult } from './finalize';

export type {
  OutboundDeps,
  ChannelResolver,
  ResolvedChannel,
  OutboundPersistencePort,
  PersistOutboundInput,
  SocketEmitPort,
  StatusEmitInput,
} from './ports';

export {
  MqOutboundPersistence,
  MqSocketEmit,
  SOCKET_RELAY_QUEUE,
  OUTBOUND_PERSIST_RK,
  OUTBOUND_PERSIST_TYPE,
} from './mq-ports';
