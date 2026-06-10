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

export const WORKERS_PKG = '@hm/workers' as const;
