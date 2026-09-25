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
  handleInstagramEchoes,
  createCoexistenceDeps,
  ownMetaAppIdsFromEnv,
  COEXISTENCE_QUEUE,
  type CoexistenceWorkerOptions,
  type CoexistenceWorkerHandle,
} from './worker';

export {
  DbCoexistencePersistence,
  DbCoexistenceChannelResolver,
  MqCoexistenceSocketEmit,
  NoopCoexistenceSocketEmit,
  PROSPECTION_TAG_NAME,
  CHANNEL_OWNER_METADATA_KEY,
  type CoexistenceChannelResolver,
  type ResolvedCoexistenceChannel,
} from './db-ports';

export type {
  CoexistenceDeps,
  CoexistencePersistencePort,
  CoexistenceSocketPort,
  CoexistenceMessageNewEmit,
  CoexistenceEchoResult,
  CoexistenceHistoryResult,
  CoexistenceAppStateResult,
} from './ports';

export { instagramEchoSchema, type InstagramEchoInput } from './instagram-echo';
// F70-S07: a regra de resposta humana mora em `@hm/shared` (uma só para a API e
// o worker). Re-exportada aqui para não quebrar quem importava do worker.
export {
  planHumanReply,
  type ConversationHumanState,
  type HumanReplyInput,
  type HumanReplyPatch,
  type HumanReplyPlan,
} from '@hm/shared';
