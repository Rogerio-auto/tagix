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
import { DOMAIN_EVENT_ROUTING_PREFIX, EXCHANGES, QUEUES, type QueueName } from './topology';

/** Exchanges que a outbox aceita (espelha o CHECK `outbox_exchange_chk` da 0086). */
export const OUTBOX_DIRECT_EXCHANGE = '' as const;
export type OutboxExchange = typeof OUTBOX_DIRECT_EXCHANGE | typeof EXCHANGES.events;

export type OutboxMessageKind = 'event' | 'job';

/** Uma linha da outbox, pronta para gravar. Só os construtores deste módulo a produzem. */
export interface OutboxMessage {
  readonly kind: OutboxMessageKind;
  /** Chave de idempotência (única por workspace na tabela, F70-S24). */
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
 *
 * **Fonte única** (F70-S24). O CHECK `outbox_job_queue_chk` do banco repete esta lista, e a
 * checagem do relay ({@link outboxRowViolation}) a lê daqui. Fila nova aqui exige migração
 * que recria o CHECK: o teste `apps/workers/src/outbox/constraints.test.ts` lê
 * `pg_get_constraintdef` e falha enquanto o banco e esta constante divergirem.
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

/**
 * Prefixo obrigatório da routing key no exchange de eventos (espelha o CHECK
 * `outbox_event_routing_chk` da 0091). O `hm.events` também tem os binds
 * `hm.q.<fila>.#` de cada fila de trabalho: sem esta trava, uma linha `event` chegaria
 * a qualquer fila por ele.
 */
export const OUTBOX_EVENT_ROUTING_PREFIX = `${DOMAIN_EVENT_ROUTING_PREFIX}.` as const;

/** O que o relay confere numa linha antes de publicar. */
export interface OutboxRouteCandidate {
  readonly kind: string;
  /** Coluna `workspace_id` da linha. */
  readonly workspaceId: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly envelope: Envelope;
}

const JOB_QUEUES: ReadonlySet<string> = new Set(OUTBOX_JOB_QUEUES);

/**
 * Motivo pelo qual a linha NÃO pode sair da outbox, ou `null` se pode. Repete, em
 * código, os CHECKs da 0091 (e o `outbox_kind_chk`/`outbox_exchange_chk` da 0086):
 *  - `kind`/`exchange` coerentes: `job` só pelo exchange padrão, `event` só por `hm.events`;
 *  - job: a fila está em {@link OUTBOX_JOB_QUEUES};
 *  - evento: a routing key começa por `domain.`;
 *  - o workspace do envelope (o que o consumidor usa) é o da coluna (o que a RLS conferiu).
 *
 * O banco já recusa essas linhas; o relay confere de novo porque é ele quem publica, e
 * uma linha que passou por fora do CHECK (constraint removida à mão, restauração parcial)
 * não pode chegar a uma fila com o tenant trocado.
 */
export function outboxRowViolation(row: OutboxRouteCandidate): string | null {
  if (row.kind === 'job') {
    if (row.exchange !== OUTBOX_DIRECT_EXCHANGE) return `job_exchange_not_allowed: ${row.exchange}`;
    if (!JOB_QUEUES.has(row.routingKey)) return `queue_not_allowed: ${row.routingKey}`;
  } else if (row.kind === 'event') {
    if (row.exchange !== EXCHANGES.events) return `event_exchange_not_allowed: ${row.exchange}`;
    if (!row.routingKey.startsWith(OUTBOX_EVENT_ROUTING_PREFIX)) {
      return `event_routing_key_not_allowed: ${row.routingKey}`;
    }
  } else {
    return `kind_not_allowed: ${row.kind}`;
  }
  // uuid canônico em minúsculas dos dois lados (a coluna é `uuid`; o CHECK compara igual).
  if (row.envelope.workspaceId.toLowerCase() !== row.workspaceId.toLowerCase()) {
    return 'workspace_mismatch: envelope.workspaceId difere da coluna workspace_id';
  }
  return null;
}
