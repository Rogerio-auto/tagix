import type { Channel } from 'amqplib';
import { z } from 'zod';
// NB: import cíclico controlado com retry.ts — ambos só se usam DENTRO de
// funções (runtime), nunca no topo do módulo, então não há leitura de valor
// indefinido durante a avaliação dos módulos (ESM).
import { assertDlq, assertRetryTopology, reliableQueues } from './retry';

export const EXCHANGES = { events: 'hm.events', dlx: 'hm.dlx' } as const;

export const QUEUES = {
  inbound: 'hm.q.inbound',
  outbound: 'hm.q.outbound',
  media: 'hm.q.media',
  campaigns: 'hm.q.campaigns',
  flows: 'hm.q.flows',
  flowExecution: 'hm.q.flow.execution',
  kbIngest: 'hm.q.kb_ingest',
  /** Eventos de coexistência WhatsApp Business (echoes/history/app_state, F39). */
  coexistence: 'hm.q.coexistence',
} as const;

/**
 * Routing keys dos eventos de coexistência (F39-S03). Reusam o exchange
 * `hm.events` e batem no bind `hm.q.coexistence.#`. Os `type` do envelope
 * espelham a routing key (sem o prefixo da fila) para o worker rotear por
 * `envelope.type`.
 */
export const COEXISTENCE_EVENT_TYPES = {
  echo: 'coexistence.echo',
  history: 'coexistence.history',
  appState: 'coexistence.app_state',
} as const;

export type CoexistenceEventType =
  (typeof COEXISTENCE_EVENT_TYPES)[keyof typeof COEXISTENCE_EVENT_TYPES];

export const COEXISTENCE_ROUTING_KEYS = {
  echo: `${QUEUES.coexistence}.echo`,
  history: `${QUEUES.coexistence}.history`,
  appState: `${QUEUES.coexistence}.app_state`,
} as const;

// --- Contrato Zod dos payloads de coexistência (F39-S03 → consumido por F39-S04) ---
//
// A BORDA (API) publica; o WORKER (F39-S04) valida com estes schemas. Mantidos
// aqui (em `@hm/shared`, onde Zod já é dependência e o envelope vive) para serem
// reusáveis tanto pela borda quanto pelo worker. O shape de runtime é
// produzido por `parseCoexistence` em `@hm/channels`.

const jsonRecord = z.record(z.unknown());

/** `coexistence.echo` — mensagem enviada pelo operador via app WhatsApp Business. */
export const coexistenceEchoSchema = z.object({
  phoneNumberId: z.string().min(1),
  externalId: z.string().min(1),
  to: z.string().min(1),
  type: z.string().min(1),
  text: z.string().optional(),
  timestamp: z.number().optional(),
  raw: jsonRecord,
});

export const coexistenceHistoryContactSchema = z.object({
  waId: z.string().min(1),
  name: z.string().optional(),
  raw: jsonRecord,
});

export const coexistenceHistoryMessageSchema = z.object({
  externalId: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
  type: z.string().optional(),
  text: z.string().optional(),
  timestamp: z.number().optional(),
  fromMe: z.boolean().optional(),
  raw: jsonRecord,
});

/** `coexistence.history` — batch de contatos/mensagens históricas de uma WABA. */
export const coexistenceHistoryBatchSchema = z.object({
  phoneNumberId: z.string().min(1),
  phase: z.string().optional(),
  contacts: z.array(coexistenceHistoryContactSchema).readonly(),
  messages: z.array(coexistenceHistoryMessageSchema).readonly(),
  raw: jsonRecord,
});

/** `coexistence.app_state` — estado do número/sessão de coexistência. */
export const coexistenceAppStateSchema = z.object({
  phoneNumberId: z.string().min(1),
  state: z.string().min(1),
  raw: jsonRecord,
});

export type CoexistenceEchoPayload = z.infer<typeof coexistenceEchoSchema>;
export type CoexistenceHistoryContactPayload = z.infer<typeof coexistenceHistoryContactSchema>;
export type CoexistenceHistoryMessagePayload = z.infer<typeof coexistenceHistoryMessageSchema>;
export type CoexistenceHistoryBatchPayload = z.infer<typeof coexistenceHistoryBatchSchema>;
export type CoexistenceAppStatePayload = z.infer<typeof coexistenceAppStateSchema>;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Declara exchanges, filas e bindings (idempotente).
 *
 * As filas de origem continuam declaradas com `{ durable: true }` apenas — SEM
 * `x-dead-letter-exchange` na declaração. Os consumers (inbound/outbound/media/
 * flows/agents/kb) re-declaram a mesma fila com `{ durable: true }`, então qualquer
 * x-argument extra AQUI geraria `PRECONDITION_FAILED (406)` no boot deles.
 *
 * O dead-letter de verdade (F52-S03) é feito pela aplicação: o helper `consume`
 * republica a mensagem que falhou numa wait-queue de retry (com backoff via TTL)
 * e, esgotadas as tentativas, na DLQ. Só as wait-queues NOVAS — que ninguém
 * re-declara — carregam os x-arguments de TTL/DLX. As filas de origem só ganham
 * um *binding* extra em `hm.dlx` (binding não altera a declaração → sem 406) para
 * receberem a re-entrada após o TTL. Ver `retry.ts` para o desenho completo.
 */
export async function assertTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(EXCHANGES.events, 'topic', { durable: true });
  await channel.assertExchange(EXCHANGES.dlx, 'topic', { durable: true });
  for (const queue of Object.values(QUEUES)) {
    await channel.assertQueue(queue, { durable: true });
    await channel.bindQueue(queue, EXCHANGES.events, `${queue}.#`);
  }

  // DLQ final + retry ladder das filas cliente-facing (inbound/outbound/media).
  await assertDlq(channel);
  for (const queue of reliableQueues()) {
    await assertRetryTopology(channel, queue);
  }
}
