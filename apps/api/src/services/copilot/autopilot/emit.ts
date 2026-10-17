/**
 * Emissão de `copilot:suggestions_changed` (COPILOTO.md §5.5) para a sala do workspace.
 *
 * Só a contagem de pendentes, sem PII. Mesmo caminho dos demais eventos do Copiloto: mensagem
 * `socket.relay` na fila `hm.q.socket.relay`, que o processo da API consome e entrega nas salas.
 * Best-effort: socket ou broker fora do ar nunca derruba a decisão nem a edição de regra.
 */
import { Buffer } from 'node:buffer';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import type { CopilotSuggestionsChangedPayload } from '@hm/shared';
import { createLogger } from '@hm/logger';

/** Fila de relay do socket (mesma constante de `apps/api/src/socket/relay.ts`). */
const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

export type SuggestionsChangedEmitter = (input: {
  readonly workspaceId: string;
  readonly payload: CopilotSuggestionsChangedPayload;
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

export const relaySuggestionsChanged: SuggestionsChangedEmitter = async ({
  workspaceId,
  payload,
}) => {
  const { channel } = await getMqHandle();
  const envelope = makeEnvelope('socket.relay', workspaceId, {
    event: 'copilot:suggestions_changed',
    target: { workspace: true },
    data: payload,
  });
  channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
};

const logger = createLogger('info', { svc: '@hm/api', component: 'copilot-autopilot' });

/** Chama o emissor e engole a falha (log sem PII). */
export async function emitSuggestionsChangedSafely(
  emit: SuggestionsChangedEmitter,
  workspaceId: string,
  pendingCount: number,
): Promise<void> {
  try {
    await emit({ workspaceId, payload: { pending_count: pendingCount } });
  } catch (err) {
    logger.warn('copilot-autopilot: falha ao emitir suggestions_changed (best-effort)', {
      errorName: err instanceof Error ? err.name : typeof err,
    });
  }
}
