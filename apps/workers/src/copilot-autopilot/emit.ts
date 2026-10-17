/**
 * Emissão de `copilot:suggestions_changed` pelo worker (F73-S13; COPILOTO.md §5.5).
 *
 * Mesmo padrão do `makeRelayEmitter` de `automations/create-event-port.ts`: mensagem
 * `socket.relay` na fila `hm.q.socket.relay`, sala do workspace, só a contagem (sem PII).
 * Best-effort: broker fora do ar vira log e nunca derruba o tick.
 */
import { Buffer } from 'node:buffer';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import type { CopilotSuggestionsChangedPayload } from '@hm/shared';
import type { Logger } from '@hm/logger';

type MqChannel = MqHandle['channel'];

/** Fila de relay do socket (mesma constante de `apps/api/src/socket/relay.ts`). */
const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

export type SuggestionsChangedEmitter = (
  workspaceId: string,
  payload: CopilotSuggestionsChangedPayload,
) => Promise<void>;

/** Emissor que reaproveita o canal de boot, ou abre a própria conexão na primeira emissão. */
export function makeSuggestionsChangedEmitter(
  logger: Logger,
  bootChannel?: MqChannel,
): SuggestionsChangedEmitter {
  let handlePromise: Promise<MqHandle> | null = null;
  const resolveChannel = async (): Promise<MqChannel> => {
    if (bootChannel) return bootChannel;
    handlePromise ??= connectMq();
    try {
      return (await handlePromise).channel;
    } catch (err) {
      handlePromise = null;
      throw err;
    }
  };
  return async (workspaceId, payload) => {
    try {
      const channel = await resolveChannel();
      const envelope = makeEnvelope('socket.relay', workspaceId, {
        event: 'copilot:suggestions_changed',
        target: { workspace: true },
        data: payload,
      });
      channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
        persistent: true,
        contentType: 'application/json',
      });
    } catch (err: unknown) {
      logger.warn('copilot-autopilot: falha ao publicar suggestions_changed (best-effort)', {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
