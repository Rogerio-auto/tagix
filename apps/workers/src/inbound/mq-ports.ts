/**
 * Implementações default das portas de saída do worker inbound via RabbitMQ.
 *
 * Igual ao outbound (F1-S07): o worker não fala com DB nem Socket.io. Publica no
 * exchange de eventos (`hm.events`, topic) com routing keys que caem nas filas
 * canônicas pelos bindings de `assertTopology` (`<queue>.#`):
 *
 * - **Persistência** → `inbound.persist.requested` com RK `hm.q.inbound.persist`
 *   → cai em `hm.q.inbound`. Um consumer DB-owner aplica dedup→contact→
 *   conversation→persist→last→cache e, pós-persist, emite `message:new` +
 *   dispara agent/flow (`ai_mode='on'`). Ver relatório do slot.
 * - **Mídia** → RK `hm.q.media.inbound` → cai em `hm.q.media`. O media-worker
 *   baixa do provider, sobe pro storage e o DB-owner casa a URL pela
 *   `externalId`. (A spec do slot chama essa fila de `hm.q.inbound.media`; a
 *   fila canônica em `topology.ts` é `hm.q.media` — ver relatório.)
 *
 * Tudo Zod-friendly: o `Envelope` carrega `payload` estruturado, validado no
 * boundary do consumer correspondente.
 */
import { Buffer } from 'node:buffer';
import { makeEnvelope, EXCHANGES, QUEUES, type MqHandle } from '@hm/shared/mq';
import { UNRESOLVED_WORKSPACE_ID } from './worker';
import type {
  InboundMediaJob,
  InboundPersistencePort,
  MediaEnqueuePort,
  PersistInboundRequest,
} from './ports';

/** Canal AMQP, derivado de `@hm/shared/mq` (sem dep direta de `amqplib`). */
type MqChannel = MqHandle['channel'];

/** Tipo do envelope de persistência inbound (discriminado pelo consumer DB). */
export const INBOUND_PERSIST_TYPE = 'inbound.persist.requested' as const;

/** Routing key da persistência inbound (cai em `hm.q.inbound`). */
export const INBOUND_PERSIST_RK = `${QUEUES.inbound}.persist` as const;

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

/**
 * Persistência via publish no exchange de eventos. O consumer DB-owner resolve
 * channel→workspace (o envelope sai com workspace NIL — o roteamento real está
 * no `payload.routing`) e aplica a mutação dentro do tenant (RLS).
 */
export class MqInboundPersistence implements InboundPersistencePort {
  constructor(private readonly channel: MqChannel) {}

  async persist(request: PersistInboundRequest): Promise<void> {
    publishEvent(this.channel, INBOUND_PERSIST_RK, INBOUND_PERSIST_TYPE, {
      provider: request.provider,
      routing: request.routing,
      events: request.events,
    });
    await Promise.resolve();
  }
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
