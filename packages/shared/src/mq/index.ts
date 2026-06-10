/**
 * @hm/shared/mq — mensageria RabbitMQ. Subpath separado (node-only) para não
 * entrar no bundle do frontend. Usado por API e workers.
 */
import { Buffer } from 'node:buffer';
import type { Channel } from 'amqplib';
import { EXCHANGES } from './topology';
import { envelopeSchema, type Envelope } from './envelope';

export * from './envelope';
export * from './topology';
export * from './kb';
export * from './flows';
export { connectMq } from './connection';
export type { MqHandle } from './connection';

/** Publica um envelope no exchange de eventos. */
export function publish(channel: Channel, routingKey: string, envelope: Envelope): boolean {
  return channel.publish(EXCHANGES.events, routingKey, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
}

/** Consome uma fila validando o envelope (Zod). ack em sucesso, nack sem requeue em erro. */
export async function consume(
  channel: Channel,
  queue: string,
  handler: (envelope: Envelope) => Promise<void>,
): Promise<void> {
  await channel.consume(queue, (msg) => {
    if (!msg) return;
    void (async () => {
      try {
        const envelope = envelopeSchema.parse(JSON.parse(msg.content.toString()));
        await handler(envelope);
        channel.ack(msg);
      } catch {
        channel.nack(msg, false, false);
      }
    })();
  });
}
