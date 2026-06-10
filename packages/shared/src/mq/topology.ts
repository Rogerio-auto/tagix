import type { Channel } from 'amqplib';

export const EXCHANGES = { events: 'hm.events', dlx: 'hm.dlx' } as const;

export const QUEUES = {
  inbound: 'hm.q.inbound',
  outbound: 'hm.q.outbound',
  media: 'hm.q.media',
  campaigns: 'hm.q.campaigns',
  flows: 'hm.q.flows',
  kbIngest: 'hm.q.kb_ingest',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Declara exchanges, filas e bindings (idempotente). DLX para mensagens mortas. */
export async function assertTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(EXCHANGES.events, 'topic', { durable: true });
  await channel.assertExchange(EXCHANGES.dlx, 'topic', { durable: true });
  for (const queue of Object.values(QUEUES)) {
    await channel.assertQueue(queue, { durable: true, deadLetterExchange: EXCHANGES.dlx });
    await channel.bindQueue(queue, EXCHANGES.events, `${queue}.#`);
  }
}
