/**
 * Implementações default das portas de saída via RabbitMQ.
 *
 * O worker não fala com DB nem Socket.io diretamente (`@hm/workers` não depende
 * de `@hm/db`/socket). Em vez disso:
 *
 * - **Persistência** → publica `outbound.persist.requested` no exchange de
 *   eventos. Um consumer DB-owner (apps/api ou worker dedicado) aplica o novo
 *   `view_status`/`external_id` e atualiza `conversation.last_*`. Roteia para a
 *   fila `hm.q.outbound` (binding `hm.q.outbound.#`).
 * - **Socket** → publica no `hm.q.socket.relay` o payload de
 *   `message:status_changed` consumido por `apps/api/src/socket/relay.ts`.
 *
 * Tudo Zod-friendly: o `Envelope` carrega `payload` estruturado, validado no
 * boundary do consumer correspondente.
 */
import { Buffer } from 'node:buffer';
import { makeEnvelope, EXCHANGES, type MqHandle } from '@hm/shared/mq';
import type {
  MessageNewEmitInput,
  OutboundPersistencePort,
  PersistOutboundInput,
  SocketEmitPort,
  StatusEmitInput,
} from './ports';

/** Canal AMQP, derivado de `@hm/shared/mq` (sem dep direta de `amqplib`). */
type MqChannel = MqHandle['channel'];

/** Fila de relay de socket (mesma constante de `apps/api/src/socket/relay.ts`). */
export const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

/** Routing key da persistência outbound (cai em `hm.q.outbound`). */
export const OUTBOUND_PERSIST_RK = 'hm.q.outbound.persist' as const;

/** Tipo do envelope de persistência (discriminado por consumers DB). */
export const OUTBOUND_PERSIST_TYPE = 'outbound.persist.requested' as const;

/**
 * Persistência via publish no exchange de eventos. O consumer DB aplica a
 * mutação dentro do tenant (RLS).
 */
export class MqOutboundPersistence implements OutboundPersistencePort {
  constructor(private readonly channel: MqChannel) {}

  async persist(input: PersistOutboundInput): Promise<void> {
    const envelope = makeEnvelope(OUTBOUND_PERSIST_TYPE, input.workspaceId, {
      conversationId: input.conversationId,
      messageId: input.messageId,
      status: input.status,
      externalId: input.externalId,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      kind: input.job.kind,
    });
    this.channel.publish(
      EXCHANGES.events,
      OUTBOUND_PERSIST_RK,
      Buffer.from(JSON.stringify(envelope)),
      { persistent: true, contentType: 'application/json' },
    );
    await Promise.resolve();
  }
}

/**
 * Emissão de socket via fila de relay. O payload espelha o contrato de
 * `relay.ts`: `{ event, target, data }`.
 */
export class MqSocketEmit implements SocketEmitPort {
  constructor(private readonly channel: MqChannel) {}

  async emitStatusChanged(input: StatusEmitInput): Promise<void> {
    const envelope = makeEnvelope('socket.relay', input.workspaceId, {
      event: 'message:status_changed',
      target: { conversationId: input.conversationId },
      data: {
        conversationId: input.conversationId,
        messageId: input.messageId,
        status: input.status,
      },
    });
    this.channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      contentType: 'application/json',
    });
    await Promise.resolve();
  }

  async emitMessageNew(input: MessageNewEmitInput): Promise<void> {
    const envelope = makeEnvelope('socket.relay', input.workspaceId, {
      event: 'message:new',
      // `workspace: true` → entrega na room `conversation:{id}` (thread aberta de
      // qualquer operador) E em `ws:{workspaceId}` (ChatList de todos reordena/
      // atualiza o preview). Espelha o inbound, que sem isto era o único a emitir.
      target: { conversationId: input.conversationId, workspace: true },
      data: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        message: {
          id: input.messageId,
          conversationId: input.conversationId,
          type: input.type,
          content: input.content,
          direction: 'outbound',
        },
      },
    });
    this.channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      contentType: 'application/json',
    });
    await Promise.resolve();
  }
}
