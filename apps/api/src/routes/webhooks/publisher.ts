/**
 * Publisher de eventos de canal na borda do webhook (F1-S02, LIVECHAT.md §1).
 *
 * A borda da API só faz: verify signature → dedup → publish. O parse e a
 * resolução de workspace/channel são do worker-inbound. Por isso o envelope sai
 * com `workspaceId` = NIL UUID (sentinela "ainda não resolvido"): o roteamento
 * real depende de `payload.provider` + ids dentro do `raw` (phone_number_id /
 * ig_user_id), que o worker mapeia para o channel/workspace.
 *
 * Usa um canal RabbitMQ lazy e compartilhado por processo; reconecta se cair.
 */
import {
  connectMq,
  makeEnvelope,
  publish,
  QUEUES,
  COEXISTENCE_EVENT_TYPES,
  COEXISTENCE_ROUTING_KEYS,
  type MqHandle,
  type CoexistenceEchoPayload,
  type CoexistenceHistoryBatchPayload,
  type CoexistenceAppStatePayload,
} from '@hm/shared/mq';
import type { ChannelProvider } from '@hm/shared';

/** Workspace ainda não resolvido na borda — o worker-inbound resolve. */
export const UNRESOLVED_WORKSPACE_ID = '00000000-0000-0000-0000-000000000000';

/** Tipo do evento publicado (routing key bind: `hm.q.inbound.#`). */
export const INBOUND_MESSAGE_TYPE = 'inbound.message';
const INBOUND_ROUTING_KEY = `${QUEUES.inbound}.message`;

let handlePromise: Promise<MqHandle> | null = null;

async function getHandle(): Promise<MqHandle> {
  handlePromise ??= connectMq();
  try {
    const handle = await handlePromise;
    return handle;
  } catch (err) {
    // Falha ao conectar: limpa o cache para a próxima tentativa reconectar.
    handlePromise = null;
    throw err;
  }
}

export interface InboundMessagePayload {
  readonly provider: ChannelProvider;
  /** Corpo bruto recebido do provider (validado/parseado pelo worker). */
  readonly raw: unknown;
}

/**
 * Publica um evento `inbound.message` no exchange de eventos. Retorna `false`
 * se o broker aplicou backpressure (buffer cheio) — o caller decide o status.
 */
export async function publishInboundMessage(payload: InboundMessagePayload): Promise<boolean> {
  const { channel } = await getHandle();
  const envelope = makeEnvelope(INBOUND_MESSAGE_TYPE, UNRESOLVED_WORKSPACE_ID, payload);
  return publish(channel, INBOUND_ROUTING_KEY, envelope);
}

// --- Coexistência WhatsApp Business (F39-S03) ---
//
// Mesmos exchange/envelope do inbound: workspace ainda NÃO resolvido na borda
// (NIL UUID) — o worker F39-S04 mapeia `phoneNumberId` → channel/workspace. A
// dedup de borda (registerWebhookEvent) já ocorreu antes destas chamadas.

/** Publica um eco de mensagem do app WhatsApp Business (`coexistence.echo`). */
export async function publishCoexistenceEcho(payload: CoexistenceEchoPayload): Promise<boolean> {
  const { channel } = await getHandle();
  const envelope = makeEnvelope(
    COEXISTENCE_EVENT_TYPES.echo,
    UNRESOLVED_WORKSPACE_ID,
    payload,
  );
  return publish(channel, COEXISTENCE_ROUTING_KEYS.echo, envelope);
}

/** Publica um batch de histórico de coexistência (`coexistence.history`). */
export async function publishHistoryBatch(
  payload: CoexistenceHistoryBatchPayload,
): Promise<boolean> {
  const { channel } = await getHandle();
  const envelope = makeEnvelope(
    COEXISTENCE_EVENT_TYPES.history,
    UNRESOLVED_WORKSPACE_ID,
    payload,
  );
  return publish(channel, COEXISTENCE_ROUTING_KEYS.history, envelope);
}

/** Publica um estado de número/sessão de coexistência (`coexistence.app_state`). */
export async function publishAppState(payload: CoexistenceAppStatePayload): Promise<boolean> {
  const { channel } = await getHandle();
  const envelope = makeEnvelope(
    COEXISTENCE_EVENT_TYPES.appState,
    UNRESOLVED_WORKSPACE_ID,
    payload,
  );
  return publish(channel, COEXISTENCE_ROUTING_KEYS.appState, envelope);
}

/** Encerra o canal/conn (testes / shutdown). */
export async function closeWebhookPublisher(): Promise<void> {
  if (!handlePromise) return;
  const pending = handlePromise;
  handlePromise = null;
  try {
    const { connection } = await pending;
    await connection.close();
  } catch {
    // já caiu — nada a fazer
  }
}
