/**
 * Emissão de `copilot:briefing_ready` (COPILOTO.md §5.5) para a sala `member:<id>`.
 *
 * Mesmo caminho dos demais eventos do Copiloto (`proposals/progress.ts`): mensagem
 * `socket.relay` na fila `hm.q.socket.relay`, que o processo da API consome e entrega nas
 * salas. Best-effort: socket ou broker fora do ar nunca derruba o agendador.
 */
import { Buffer } from 'node:buffer';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import type { CopilotBriefingReadyPayload } from '@hm/shared';

/** Fila de relay do socket (mesma constante de `apps/api/src/socket/relay.ts`). */
const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

export type BriefingReadyEmitter = (input: {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly payload: CopilotBriefingReadyPayload;
}) => Promise<void>;

let handlePromise: Promise<MqHandle> | null = null;

async function getMqHandle(): Promise<MqHandle> {
  handlePromise ??= connectMq();
  try {
    return await handlePromise;
  } catch (err) {
    handlePromise = null;
    throw err;
  }
}

export const relayBriefingReady: BriefingReadyEmitter = async ({
  workspaceId,
  memberId,
  payload,
}) => {
  const { channel } = await getMqHandle();
  const envelope = makeEnvelope('socket.relay', workspaceId, {
    event: 'copilot:briefing_ready',
    target: { memberId },
    data: payload,
  });
  channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
};
