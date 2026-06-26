/**
 * Impl real do `FlowEventsPort` (F51-S03): publica `flow_execution:updated` em `hm.q.socket.relay`
 * a cada transição de estado de uma execução de flow. Espelha `emitMessageNewRelay` do
 * `outbound-publisher.ts` (canal lazy singleton + makeEnvelope + sendToQueue persistent).
 *
 * Best-effort por contrato (`FlowEventsPort`): NUNCA lança — uma falha de socket não pode abortar
 * um step de flow (o dispatcher já chama isto dentro do step). `send` é injetável p/ testar sem MQ.
 */
import { Buffer } from 'node:buffer';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import type { FlowEventsPort, FlowExecutionEvent } from '@hm/flow-engine';
import type { FlowExecutionUpdatedPayload } from '@hm/shared';
import type { Logger } from '@hm/logger';

const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

let handlePromise: Promise<MqHandle> | null = null;

async function getHandle(): Promise<MqHandle> {
  handlePromise ??= connectMq();
  try {
    return await handlePromise;
  } catch (err) {
    handlePromise = null;
    throw err;
  }
}

/** Payload do envelope de relay (event + roteamento + data). */
export interface RelayEnvelopePayload {
  readonly event: 'flow_execution:updated';
  readonly target: { conversationId?: string; workspace: true };
  readonly data: FlowExecutionUpdatedPayload;
}

/** Publica o envelope em `hm.q.socket.relay`. Injetável nos testes. */
export type RelaySend = (workspaceId: string, payload: RelayEnvelopePayload) => Promise<void> | void;

async function defaultSend(workspaceId: string, payload: RelayEnvelopePayload): Promise<void> {
  const { channel } = await getHandle();
  const envelope = makeEnvelope('socket.relay', workspaceId, payload);
  channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
}

export interface FlowEventsPublisherDeps {
  readonly logger: Logger;
  /** Publicação do envelope (default: RabbitMQ real). */
  readonly send?: RelaySend;
}

export function createFlowEventsPublisher(deps: FlowEventsPublisherDeps): FlowEventsPort {
  const send = deps.send ?? defaultSend;
  return {
    async executionChanged(e: FlowExecutionEvent): Promise<void> {
      try {
        const data: FlowExecutionUpdatedPayload = {
          conversationId: e.conversationId,
          flowId: e.flowId,
          executionId: e.executionId,
          status: e.status,
          nextStepAt: e.nextStepAt ? e.nextStepAt.toISOString() : null,
        };
        await send(e.workspaceId, {
          event: 'flow_execution:updated',
          target: { conversationId: e.conversationId ?? undefined, workspace: true },
          data,
        });
      } catch (err) {
        deps.logger.warn('flow-events: falha ao publicar evento de execução (ignorado)', {
          error: err instanceof Error ? err.message : String(err),
          executionId: e.executionId,
        });
      }
    },
  };
}

/** Encerra o canal/conn (testes / shutdown). */
export async function closeFlowEventsPublisher(): Promise<void> {
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
