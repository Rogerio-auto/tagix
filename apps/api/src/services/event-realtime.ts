/**
 * Emissao de eventos de socket do dominio Calendar/Agenda (F54-S01 / AGENDA_SYNC.md §1).
 *
 * Espelha `deal-events.ts`: publica `event:*` na fila de relay `hm.q.socket.relay`; o
 * relay (apps/api/src/socket/relay.ts) reemite via Socket.io para a room `ws:{id}`. O
 * relay valida o nome do evento contra `SERVER_TO_CLIENT_EVENTS` — por isso os nomes
 * foram adicionados a @hm/shared primeiro.
 *
 * Best-effort por design: falha de broker NAO derruba a mutacao de evento (a persistencia
 * ja aconteceu) — apenas e silenciada. Os handlers de mutacao (events.ts) chamam estas
 * funcoes com `void emit...`, sem bloquear a resposta.
 */
import { Buffer } from 'node:buffer';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import type { EventChangedPayload, ServerToClientEvent } from '@hm/shared';

/** Fila de relay do socket (mesma constante de apps/api/src/socket/relay.ts). */
const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

let handlePromise: Promise<MqHandle> | null = null;
async function getMqHandle(): Promise<MqHandle> {
  handlePromise ??= connectMq();
  return handlePromise;
}

/** Override de teste p/ injetar um canal fake (sem broker). */
export interface EventRealtimePublisher {
  publish(event: ServerToClientEvent, workspaceId: string, data: unknown): Promise<void>;
}

let publisher: EventRealtimePublisher | null = null;
export function setEventRealtimePublisher(p: EventRealtimePublisher | null): void {
  publisher = p;
}

async function publish(
  event: ServerToClientEvent,
  workspaceId: string,
  data: unknown,
): Promise<void> {
  if (publisher) {
    await publisher.publish(event, workspaceId, data);
    return;
  }
  try {
    const { channel } = await getMqHandle();
    const envelope = makeEnvelope('socket.relay', workspaceId, {
      event,
      target: { workspace: true },
      data,
    });
    channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      contentType: 'application/json',
    });
  } catch {
    // Best-effort: o evento de socket e side-effect; a mutacao ja foi persistida.
  }
  await Promise.resolve();
}

export function emitEventCreated(p: EventChangedPayload): Promise<void> {
  return publish('event:created', p.workspaceId, p);
}

export function emitEventUpdated(p: EventChangedPayload): Promise<void> {
  return publish('event:updated', p.workspaceId, p);
}

export function emitEventDeleted(p: EventChangedPayload): Promise<void> {
  return publish('event:deleted', p.workspaceId, p);
}

export { SOCKET_RELAY_QUEUE };
