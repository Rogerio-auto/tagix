/**
 * Consumer de eventos de domínio → fan-out de webhooks de saída (F70-S09).
 *
 * Fecha o elo que faltava: `fanoutEvent` existia, mas ninguém consumia os eventos,
 * então os webhooks de saída só disparavam pelo `/test`.
 *
 * ```
 * hm.events (rk domain.<evento>) → hm.q.webhooks → parseDomainEnvelope (Zod)
 *   → fanoutEvent (deliveries duráveis, dedup por eventId) → ack
 * ```
 *
 * Garantias:
 *  - **ack só depois do fan-out gravar.** `consume` dá ack quando o handler resolve;
 *    o handler só resolve depois que todas as deliveries foram inseridas.
 *  - **idempotência pelo id do evento.** Reentrega da fila (queda antes do ack) ou
 *    republicação do produtor carregam o mesmo `eventId` → o fan-out não duplica.
 *  - **retentativa e DLQ.** `hm.q.webhooks` está em `reliableQueues()`: falha de
 *    banco retenta com backoff (5s → 30min); esgotada, cai na DLQ monitorada.
 *    Evento fora do catálogo/contrato é erro de conteúdo → DLQ direto.
 */
import { connectMq, consume, parseDomainEnvelope, QUEUES, type Envelope } from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import { fanoutEvent, type FanoutResult, type WebhookEvent } from './fanout';

export const WEBHOOKS_QUEUE = QUEUES.webhooks;

/** Fan-out em paralelo por consumer: cada evento é 1 SELECT + 1 tx por assinante. */
const PREFETCH = 8;

export interface WebhookFanoutDeps {
  readonly logger: Logger;
  /** Injetável p/ teste. Default: `fanoutEvent` (Postgres). */
  readonly fanout?: (evt: WebhookEvent) => Promise<FanoutResult>;
}

/** Processa um envelope (testável sem RabbitMQ). Lança para retry/DLQ. */
export async function handleDomainEventEnvelope(
  envelope: Envelope,
  deps: WebhookFanoutDeps,
): Promise<FanoutResult> {
  const evt = parseDomainEnvelope(envelope);
  const fanout = deps.fanout ?? fanoutEvent;
  const result = await fanout({
    workspaceId: evt.workspaceId,
    event: evt.event,
    eventId: evt.eventId,
    occurredAt: evt.occurredAt,
    data: evt.data,
  });
  if (result.created > 0 || result.deduped > 0) {
    deps.logger.info('webhook fanout', {
      event: evt.event,
      eventId: evt.eventId,
      workspaceId: evt.workspaceId,
      ...result,
    });
  }
  return result;
}

export interface WebhookFanoutWorkerHandle {
  stop(): Promise<void>;
}

/** Sobe o consumer de `hm.q.webhooks` numa conexão própria. */
export async function startWebhookFanoutWorker(
  deps: WebhookFanoutDeps,
): Promise<WebhookFanoutWorkerHandle> {
  const { connection, channel } = await connectMq();
  await channel.assertQueue(WEBHOOKS_QUEUE, { durable: true });
  await channel.prefetch(PREFETCH);

  await consume(
    channel,
    WEBHOOKS_QUEUE,
    async (envelope) => {
      await handleDomainEventEnvelope(envelope, deps);
    },
    { logger: deps.logger },
  );

  deps.logger.info('webhook fanout worker iniciado', { queue: WEBHOOKS_QUEUE });
  return {
    async stop(): Promise<void> {
      await channel.close();
      await connection.close();
    },
  };
}
