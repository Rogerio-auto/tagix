/**
 * Worker de coexistência WhatsApp Business (F39-S04) — barrel.
 *
 * Consome `hm.q.coexistence` (eventos de F39-S03) e materializa no domínio:
 * echoes do app → mensagens outbound; import idempotente de histórico
 * (contatos+mensagens); app_state → estado do canal. Persistência DIRETA via
 * `@hm/db` + RLS, idempotente por id externo.
 */
export {
  startCoexistenceWorker,
  handleCoexistenceEnvelope,
  createCoexistenceDeps,
  COEXISTENCE_QUEUE,
  type CoexistenceWorkerOptions,
  type CoexistenceWorkerHandle,
} from './worker';

export {
  DbCoexistencePersistence,
  DbCoexistenceChannelResolver,
  type CoexistenceChannelResolver,
  type ResolvedCoexistenceChannel,
} from './db-ports';

export type {
  CoexistenceDeps,
  CoexistencePersistencePort,
  CoexistenceEchoResult,
  CoexistenceHistoryResult,
  CoexistenceAppStateResult,
} from './ports';
