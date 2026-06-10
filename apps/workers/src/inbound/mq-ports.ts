/**
 * Implementação default do enfileiramento de mídia do worker inbound via
 * RabbitMQ (F1-S26).
 *
 * Diferente da persistência (que em F1-S26 passou a ser DIRETA via `@hm/db` —
 * ver `db-ports.ts`), a mídia continua saindo por MQ: o media-worker (F1-S10) é
 * um consumer independente. Publica no exchange de eventos (`hm.events`, topic)
 * com a routing key que cai na fila canônica pelo binding de `assertTopology`
 * (`<queue>.#`):
 *
 * - **Mídia** → RK `hm.q.media.inbound` → cai em `hm.q.media`. O media-worker
 *   baixa do provider, sobe pro storage e casa a URL pela `externalId`. (A spec
 *   do slot chama essa fila de `hm.q.inbound.media`; a fila canônica em
 *   `topology.ts` é `hm.q.media`.)
 *
 * Tudo Zod-friendly: o `Envelope` carrega `payload` estruturado, validado no
 * boundary do consumer (`media/job.ts`).
 */
import { Buffer } from 'node:buffer';
import { makeEnvelope, EXCHANGES, QUEUES, type MqHandle } from '@hm/shared/mq';
import { UNRESOLVED_WORKSPACE_ID } from './worker';
import type { InboundMediaJob, MediaEnqueuePort } from './ports';

/** Canal AMQP, derivado de `@hm/shared/mq` (sem dep direta de `amqplib`). */
type MqChannel = MqHandle['channel'];

/** Tipo do envelope de job de mídia inbound. */
export const INBOUND_MEDIA_TYPE = 'inbound.media.requested' as const;

/** Routing key do job de mídia (cai em `hm.q.media`). */
export const INBOUND_MEDIA_RK = `${QUEUES.media}.inbound` as const;

/** Publica `envelope` no exchange de eventos com a routing key dada. */
function publishEvent(channel: MqChannel, routingKey: string, type: string, payload: unknown): void {
  const envelope = makeEnvelope(type, UNRESOLVED_WORKSPACE_ID, payload);
  channel.publish(EXCHANGES.events, routingKey, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
}

/** Enfileiramento de mídia via publish no exchange de eventos (cai em `hm.q.media`). */
export class MqMediaEnqueue implements MediaEnqueuePort {
  constructor(private readonly channel: MqChannel) {}

  async enqueue(job: InboundMediaJob): Promise<void> {
    publishEvent(this.channel, INBOUND_MEDIA_RK, INBOUND_MEDIA_TYPE, {
      provider: job.provider,
      externalId: job.externalId,
      mediaRef: job.mediaRef,
      routing: job.routing,
    });
    await Promise.resolve();
  }
}
