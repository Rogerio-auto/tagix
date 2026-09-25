/**
 * @hm/shared/mq/outbox — o que vai para a outbox transacional (F70-S16).
 *
 * O produtor não publica mais: monta aqui a {@link OutboxMessage} e a grava com
 * `enqueueOutbox(tx, …)` (`@hm/db`) na MESMA transação do dado. O relay dos workers
 * publica depois, com publisher confirms, pelo menos uma vez.
 *
 * - Evento de domínio: {@link domainEventOutbox} / {@link domainEventsOutbox}. Destino
 *   `hm.events` com routing key `domain.<evento>`; `eventId` = eventId canônico do
 *   catálogo (a mesma chave que deduplica o fan-out), então o mesmo evento gravado duas
 *   vezes vira uma linha.
 * - Job numa fila de trabalho: {@link queueJobOutbox}. Destino = a fila, pelo exchange
 *   padrão (`''`); `eventId` = id do envelope.
 *
 * O envelope é montado e validado aqui, uma vez: o relay publica byte a byte o que foi
 * gravado, com o mesmo `envelope.id` em toda republicação.
 */
import { envelopeSchema, type Envelope } from './envelope';
import {
  buildDomainEnvelope,
  domainEventRoutingKey,
  reportDomainEventFailure,
  type DomainEventDraft,
} from './domain-events';
import { EXCHANGES, QUEUES, type QueueName } from './topology';

/** Exchanges que a outbox aceita (espelha o CHECK `outbox_exchange_chk` da 0086). */
export const OUTBOX_DIRECT_EXCHANGE = '' as const;
export type OutboxExchange = typeof OUTBOX_DIRECT_EXCHANGE | typeof EXCHANGES.events;

export type OutboxMessageKind = 'event' | 'job';

/** Uma linha da outbox, pronta para gravar. Só os construtores deste módulo a produzem. */
export interface OutboxMessage {
  readonly kind: OutboxMessageKind;
  /** Chave de idempotência (única na tabela). */
  readonly eventId: string;
  readonly exchange: OutboxExchange;
  readonly routingKey: string;
  readonly envelope: Envelope;
}

/**
 * Evento de domínio → mensagem da outbox. Lança se o `data` viola o contrato do
 * evento (defeito do produtor) — prefira {@link domainEventsOutbox} dentro de uma
 * transação de negócio, que não derruba a mutação por causa do aviso.
 */
export function domainEventOutbox(draft: DomainEventDraft): OutboxMessage {
  return {
    kind: 'event',
    eventId: draft.eventId,
    exchange: EXCHANGES.events,
    routingKey: domainEventRoutingKey(draft.event),
    // O envelope inteiro passa pelo contrato da fila (workspaceId uuid inclusive):
    // o consumidor o rejeitaria de qualquer forma.
    envelope: envelopeSchema.parse(buildDomainEnvelope(draft)),
  };
}

/**
 * Vários eventos → mensagens, na ordem. Evento que viola o contrato é LOGADO e
 * descartado: a mutação que ele descreve não pode falhar por causa do aviso — e um
 * contrato violado é defeito de código, que nenhuma retentativa conserta.
 */
export function domainEventsOutbox(drafts: readonly DomainEventDraft[]): OutboxMessage[] {
  const out: OutboxMessage[] = [];
  for (const draft of drafts) {
    try {
      out.push(domainEventOutbox(draft));
    } catch (err: unknown) {
      reportDomainEventFailure(draft, err);
    }
  }
  return out;
}

/**
 * Filas de trabalho que aceitam job pela outbox (as que têm produtor transacional):
 * - `outbound`: envios da API v1, do LiveChat, das ações de comentário do Instagram e
 *   do teste do criador de campanhas; campanhas e followups; envio dos flows; resposta
 *   do agente de IA; lembretes da agenda (F70-S16/S20/S21);
 * - `media`: download da mídia recebida (inbound) e dos ecos e do histórico da
 *   coexistência (F70-S20/S21);
 * - `flows`: gatilho de turno do agente de IA (inbound, troca de agente, transferência,
 *   retomada, follow-up — F70-S25);
 * - `flowExecution`: passo de flow, gravado com a transição da execução (F70-S25);
 * - `campaigns`: followup `on_reply` de campanha, com a marca de resposta (F70-S25).
 */
export const OUTBOX_JOB_QUEUES = [
  QUEUES.outbound,
  QUEUES.media,
  QUEUES.flows,
  QUEUES.flowExecution,
  QUEUES.campaigns,
] as const satisfies readonly QueueName[];
export type OutboxJobQueue = (typeof OUTBOX_JOB_QUEUES)[number];

/** Job numa fila de trabalho → mensagem da outbox (publicada direto na fila). */
export function queueJobOutbox(queue: OutboxJobQueue, envelope: Envelope): OutboxMessage {
  const parsed = envelopeSchema.parse(envelope);
  return {
    kind: 'job',
    eventId: parsed.id,
    exchange: OUTBOX_DIRECT_EXCHANGE,
    routingKey: queue,
    envelope: parsed,
  };
}
