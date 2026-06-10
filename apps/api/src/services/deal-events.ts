/**
 * Emissao de eventos de socket do dominio Pipeline (F5-S07 / PIPELINE.md §6.1).
 *
 * Publica `deal:*` / `pipeline:*` na fila de relay `hm.q.socket.relay`; o relay
 * (apps/api/src/socket/relay.ts) reemite via Socket.io para a room `ws:{id}`.
 * O relay valida o nome do evento contra `SERVER_TO_CLIENT_EVENTS` — por isso os
 * tipos foram adicionados a @hm/shared primeiro.
 *
 * Best-effort por design: falha de broker NAO derruba a operacao de deal (a
 * mutacao ja foi persistida) — apenas loga. O seam onStageChanged (F5-S05) e os
 * handlers de CRUD (gap-fill do orchestrator) chamam estas funcoes.
 */
import { Buffer } from 'node:buffer';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import type {
  DealCreatedPayload,
  DealDeletedPayload,
  DealStageChangedPayload,
  DealUpdatedPayload,
  PipelineUpdatedPayload,
  ServerToClientEvent,
} from '@hm/shared';

/** Fila de relay do socket (mesma constante de apps/api/src/socket/relay.ts). */
const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

let handlePromise: Promise<MqHandle> | null = null;
async function getMqHandle(): Promise<MqHandle> {
  handlePromise ??= connectMq();
  return handlePromise;
}

/** Override de teste p/ injetar um canal fake (sem broker). */
export interface DealEventPublisher {
  publish(event: ServerToClientEvent, workspaceId: string, data: unknown): Promise<void>;
}

let publisher: DealEventPublisher | null = null;
export function setDealEventPublisher(p: DealEventPublisher | null): void {
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

export function emitDealCreated(p: DealCreatedPayload): Promise<void> {
  return publish('deal:created', p.workspaceId, p);
}

export function emitDealUpdated(p: DealUpdatedPayload): Promise<void> {
  return publish('deal:updated', p.workspaceId, p);
}

export function emitDealStageChanged(p: DealStageChangedPayload): Promise<void> {
  return publish('deal:stage_changed', p.workspaceId, p);
}

export function emitDealDeleted(p: DealDeletedPayload): Promise<void> {
  return publish('deal:deleted', p.workspaceId, p);
}

export function emitPipelineUpdated(p: PipelineUpdatedPayload): Promise<void> {
  return publish('pipeline:updated', p.workspaceId, p);
}

export { SOCKET_RELAY_QUEUE };
