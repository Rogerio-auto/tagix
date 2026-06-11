/**
 * Emissão do evento `dashboard:metric_changed` (DASHBOARD.md §5/§8).
 *
 * Espelha o transporte de `deal-events.ts`: publica na fila de relay
 * `hm.q.socket.relay`; o relay (apps/api/src/socket/relay.ts) reemite via Socket.io
 * para a room `ws:{id}` (validando o nome do evento contra `SERVER_TO_CLIENT_EVENTS`).
 * Best-effort: falha de broker não derruba a operação que disparou a mudança.
 *
 * A filtragem por role é **server-side por construção**: só emitimos métricas de
 * estado operacional (cadência socket) e o client reage apenas se a métrica está no
 * seu conjunto (DASHBOARD §8). O payload nunca carrega dado de outro role.
 */
import { Buffer } from 'node:buffer';
import { connectMq, makeEnvelope, type MqHandle } from '@hm/shared/mq';
import type { DashboardMetricChangedPayload } from '@hm/shared';

const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

let handlePromise: Promise<MqHandle> | null = null;
async function getMqHandle(): Promise<MqHandle> {
  handlePromise ??= connectMq();
  return handlePromise;
}

/** Override de teste p/ injetar um publisher fake (sem broker). */
export interface DashboardEventPublisher {
  publish(workspaceId: string, payload: DashboardMetricChangedPayload): Promise<void>;
}

let publisher: DashboardEventPublisher | null = null;
export function setDashboardEventPublisher(p: DashboardEventPublisher | null): void {
  publisher = p;
}

export async function emitDashboardMetricChanged(
  payload: DashboardMetricChangedPayload,
): Promise<void> {
  if (publisher) {
    await publisher.publish(payload.workspaceId, payload);
    return;
  }
  try {
    const { channel } = await getMqHandle();
    const envelope = makeEnvelope('socket.relay', payload.workspaceId, {
      event: 'dashboard:metric_changed',
      target: { workspace: true },
      data: payload,
    });
    channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      contentType: 'application/json',
    });
  } catch {
    // Best-effort: socket é side-effect; o estado já foi persistido.
  }
  await Promise.resolve();
}

export { SOCKET_RELAY_QUEUE };
