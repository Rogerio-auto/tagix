import type { Channel } from 'amqplib';

export const EXCHANGES = { events: 'hm.events', dlx: 'hm.dlx' } as const;

export const QUEUES = {
  inbound: 'hm.q.inbound',
  outbound: 'hm.q.outbound',
  media: 'hm.q.media',
  campaigns: 'hm.q.campaigns',
  flows: 'hm.q.flows',
  flowExecution: 'hm.q.flow.execution',
  kbIngest: 'hm.q.kb_ingest',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Declara exchanges, filas e bindings (idempotente).
 *
 * As filas são declaradas com `{ durable: true }` apenas — SEM
 * `deadLetterExchange`. Os consumers (inbound/outbound/media/flows/agents/kb)
 * re-declaram a mesma fila com `{ durable: true }`, então qualquer arg extra aqui
 * gera `PRECONDITION_FAILED (406)` no boot. A `hm.dlx` continua declarada para
 * uso futuro, mas nenhuma fila roteia para ela hoje (não há consumer de DLX).
 * TODO(follow-up): DLX de verdade exige alinhar os 6 consumers + nack routing.
 */
export async function assertTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(EXCHANGES.events, 'topic', { durable: true });
  await channel.assertExchange(EXCHANGES.dlx, 'topic', { durable: true });
  for (const queue of Object.values(QUEUES)) {
    await channel.assertQueue(queue, { durable: true });
    await channel.bindQueue(queue, EXCHANGES.events, `${queue}.#`);
  }
}
