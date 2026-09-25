/**
 * @hm/shared/mq/domain-events — catálogo, contrato e publicação dos eventos de
 * domínio (F70-S09).
 *
 * ## O que é
 * Eventos de negócio que outros sistemas assinam por webhook (o Rogério OS em
 * primeiro lugar): mensagem recebida/enviada, conversa aberta/resolvida/entregue a
 * um humano, deal criado/movido/ganho/perdido, conversão registrada.
 *
 * ## Fluxo
 * ```
 * produtor (API/worker), DEPOIS do commit
 *   └─ emitDomainEvent(draft) ─► hm.events  rk = domain.<evento>
 *                                   └─► hm.q.webhooks (bind domain.#)
 *                                         └─► consumer webhooks → fanoutEvent
 *                                               └─► outbound_webhook_deliveries
 *                                                     └─► dispatcher (HMAC + retry)
 * ```
 *
 * ## Contrato
 * - `envelope.type` = nome do evento (catálogo {@link DOMAIN_EVENTS}).
 * - `envelope.payload` = `{ eventId, occurredAt, data }`.
 * - `eventId` é o id ESTÁVEL da ocorrência (ex.: `<messageId>:received`). É ele
 *   que deduplica no fan-out: reentrega da fila ou republicação do produtor não
 *   duplicam a entrega ao cliente. `envelope.id` identifica só a cópia na fila.
 * - `data` é validado com schema ESTRITO por evento na publicação: campo que não
 *   está no contrato não sai (nenhum dado pessoal vaza por descuido de um
 *   produtor). O contrato público vive em `docs/api-reference/guides/webhook-events.mdx`.
 *
 * ## Por que o produtor publica depois do commit
 * Evento de webhook dispara ação num sistema de fora. Publicar dentro da
 * transação arriscaria avisar algo que o rollback desfez. Todos os produtores
 * chamam {@link emitDomainEvent} depois que a transação devolve. Ele nunca lança:
 * a mutação já está gravada e não pode falhar por causa do aviso.
 */
import { randomUUID } from 'node:crypto';
import type { Channel } from 'amqplib';
import { z } from 'zod';
import { makeEnvelope, type Envelope } from './envelope';
import { connectMq, type MqHandle } from './connection';
import { publishWithBackpressure } from './publish';
import { NonRetryableError, type RetryLogger } from './retry';
import { DOMAIN_EVENT_ROUTING_PREFIX } from './topology';

// ─── Catálogo ─────────────────────────────────────────────────────────────────

/** Catálogo ÚNICO dos eventos assináveis (a API de webhooks deriva dele). */
export const DOMAIN_EVENTS = [
  'message.received',
  'message.sent',
  'conversation.opened',
  'conversation.resolved',
  'conversation.handoff',
  'deal.created',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'conversion.registered',
] as const;

export type DomainEventName = (typeof DOMAIN_EVENTS)[number];

export function isDomainEventName(value: string): value is DomainEventName {
  return (DOMAIN_EVENTS as readonly string[]).includes(value);
}

export function domainEventRoutingKey(event: DomainEventName): string {
  return `${DOMAIN_EVENT_ROUTING_PREFIX}.${event}`;
}

// ─── Contrato de dados por evento (estrito) ───────────────────────────────────

const id = z.string().uuid();
const currency = z.string().length(3);
const cents = z.number().int().min(0);

const messageReceivedData = z
  .object({
    conversationId: id,
    messageId: id,
    contactId: id.nullable(),
    channelId: id,
    type: z.string().min(1).max(64),
    text: z.string().nullable(),
  })
  .strict();

const messageSentData = z
  .object({
    conversationId: id,
    messageId: id,
    type: z.string().min(1).max(64),
    text: z.string().nullable(),
  })
  .strict();

/**
 * Como a conversa passou a estar aberta (F70-S14). Todos, menos `reopened`, são a
 * CRIAÇÃO da conversa — uma vez por conversa; `reopened` pode se repetir.
 * - `inbound`  — a primeira mensagem do contato criou a conversa;
 * - `lead_ad`  — um formulário de anúncio da Meta (lead ads) criou a conversa;
 * - `app_echo` — a empresa escreveu primeiro pelo app do WhatsApp/Instagram (eco);
 * - `history`  — a importação do histórico do app trouxe uma conversa nova;
 * - `campaign` — o disparo de uma campanha criou a conversa;
 * - `reopened` — conversa resolvida voltou a ficar aberta.
 */
export const CONVERSATION_OPENED_TRIGGERS = [
  'inbound',
  'lead_ad',
  'app_echo',
  'history',
  'campaign',
  'reopened',
] as const;

export type ConversationOpenedTrigger = (typeof CONVERSATION_OPENED_TRIGGERS)[number];

const conversationOpenedData = z
  .object({
    conversationId: id,
    contactId: id.nullable(),
    channelId: id.nullable(),
    trigger: z.enum(CONVERSATION_OPENED_TRIGGERS),
  })
  .strict();

const conversationResolvedData = z
  .object({
    conversationId: id,
    resolvedBy: z.enum(['member', 'agent']),
    memberId: id.nullable(),
    agentId: id.nullable(),
  })
  .strict();

/**
 * A IA pediu humano. Mínimo de propósito: SEM o `reason` que o modelo escreve
 * (texto livre, pode citar dado pessoal do contato). Quem precisa do contexto lê a
 * conversa pela API com a própria credencial.
 */
const conversationHandoffData = z
  .object({
    conversationId: id,
    agentId: id,
    departmentId: id.nullable(),
  })
  .strict();

const dealCreatedData = z
  .object({
    dealId: id,
    pipelineId: id,
    stageId: id,
    contactId: id,
    conversationId: id.nullable(),
    valueCents: cents,
    currency,
  })
  .strict();

const dealStageChangedData = z
  .object({
    dealId: id,
    pipelineId: id,
    fromStageId: id,
    toStageId: id,
    actorType: z.enum(['member', 'agent', 'system', 'api']),
  })
  .strict();

const dealClosedData = z
  .object({
    dealId: id,
    pipelineId: id,
    stageId: id,
    contactId: id,
    valueCents: cents,
    currency,
  })
  .strict();

const conversionRegisteredData = z
  .object({
    conversionId: id,
    conversionTypeId: id,
    contactId: id,
    conversationId: id.nullable(),
    dealId: id.nullable(),
    valueCents: cents.nullable(),
    currency,
    source: z.string().min(1).max(64),
  })
  .strict();

export const DOMAIN_EVENT_DATA_SCHEMAS = {
  'message.received': messageReceivedData,
  'message.sent': messageSentData,
  'conversation.opened': conversationOpenedData,
  'conversation.resolved': conversationResolvedData,
  'conversation.handoff': conversationHandoffData,
  'deal.created': dealCreatedData,
  'deal.stage_changed': dealStageChangedData,
  'deal.won': dealClosedData,
  'deal.lost': dealClosedData,
  'conversion.registered': conversionRegisteredData,
} as const satisfies Record<DomainEventName, z.ZodTypeAny>;

export type DomainEventData<K extends DomainEventName> = z.infer<
  (typeof DOMAIN_EVENT_DATA_SCHEMAS)[K]
>;

/** Um evento pronto para publicar (união discriminada por `event`). */
export type DomainEventDraft = {
  [K in DomainEventName]: {
    readonly event: K;
    readonly workspaceId: string;
    /** Id estável da ocorrência — dedup no fan-out. */
    readonly eventId: string;
    readonly occurredAt: string;
    readonly data: DomainEventData<K>;
  };
}[DomainEventName];

/** Payload do envelope na fila (contrato produtor → consumer). */
export const domainEventPayloadSchema = z.object({
  eventId: z.string().min(1).max(256),
  occurredAt: z.string().datetime(),
  data: z.record(z.unknown()),
});

export type DomainEventPayload = z.infer<typeof domainEventPayloadSchema>;

/** Evento lido da fila, já validado. */
export interface ParsedDomainEvent {
  readonly event: DomainEventName;
  readonly workspaceId: string;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly data: Record<string, unknown>;
}

/**
 * Monta o envelope validando o `data` contra o contrato estrito do evento. Lança
 * se o produtor montou errado (defeito de código, nunca dado de fora).
 */
export function buildDomainEnvelope(draft: DomainEventDraft): Envelope {
  const data: unknown = DOMAIN_EVENT_DATA_SCHEMAS[draft.event].parse(draft.data);
  const payload: DomainEventPayload = domainEventPayloadSchema.parse({
    eventId: draft.eventId,
    occurredAt: draft.occurredAt,
    data,
  });
  return makeEnvelope(draft.event, draft.workspaceId, payload);
}

/**
 * Lê um envelope de evento de domínio. Evento fora do catálogo ou payload fora do
 * contrato é erro de CONTEÚDO: {@link NonRetryableError} (vai direto à DLQ, onde o
 * monitor alerta — nunca some em silêncio, nunca gasta retentativa).
 */
export function parseDomainEnvelope(envelope: Envelope): ParsedDomainEvent {
  if (!isDomainEventName(envelope.type)) {
    throw new NonRetryableError(`evento de domínio desconhecido: ${envelope.type}`);
  }
  const parsed = domainEventPayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    throw new NonRetryableError(`payload inválido para ${envelope.type}`, parsed.error.issues);
  }
  return {
    event: envelope.type,
    workspaceId: envelope.workspaceId,
    eventId: parsed.data.eventId,
    occurredAt: parsed.data.occurredAt,
    data: parsed.data.data,
  };
}

/** Publica um evento de domínio num canal já aberto (respeita backpressure). */
export async function publishDomainEvent(channel: Channel, draft: DomainEventDraft): Promise<void> {
  await publishWithBackpressure(channel, domainEventRoutingKey(draft.event), buildDomainEnvelope(draft));
}

// ─── Construtores (um por evento: eventId canônico num lugar só) ──────────────

function nowIso(): string {
  return new Date().toISOString();
}

export const domainEvents = {
  messageReceived(
    workspaceId: string,
    data: DomainEventData<'message.received'>,
  ): DomainEventDraft {
    return {
      event: 'message.received',
      workspaceId,
      eventId: `${data.messageId}:received`,
      occurredAt: nowIso(),
      data,
    };
  },

  messageSent(workspaceId: string, data: DomainEventData<'message.sent'>): DomainEventDraft {
    return {
      event: 'message.sent',
      workspaceId,
      eventId: `${data.messageId}:sent`,
      occurredAt: nowIso(),
      data,
    };
  },

  /**
   * Criação é única por conversa, qualquer que seja a origem: eventId
   * `<id>:opened` (o `trigger` diz a origem, não muda a identidade — se dois
   * caminhos disputassem a criação, só um aviso sai). Reabertura pode se repetir,
   * então cada uma ganha sua própria ocorrência.
   */
  conversationOpened(
    workspaceId: string,
    data: DomainEventData<'conversation.opened'>,
    occurrenceId: string = randomUUID(),
  ): DomainEventDraft {
    return {
      event: 'conversation.opened',
      workspaceId,
      eventId:
        data.trigger !== 'reopened'
          ? `${data.conversationId}:opened`
          : `${data.conversationId}:reopened:${occurrenceId}`,
      occurredAt: nowIso(),
      data,
    };
  },

  conversationResolved(
    workspaceId: string,
    data: DomainEventData<'conversation.resolved'>,
    occurrenceId: string = randomUUID(),
  ): DomainEventDraft {
    return {
      event: 'conversation.resolved',
      workspaceId,
      eventId: `${data.conversationId}:resolved:${occurrenceId}`,
      occurredAt: nowIso(),
      data,
    };
  },

  /** `occurrenceId` = execução do agente: repetir a tool na mesma execução não duplica. */
  conversationHandoff(
    workspaceId: string,
    data: DomainEventData<'conversation.handoff'>,
    occurrenceId: string = randomUUID(),
  ): DomainEventDraft {
    return {
      event: 'conversation.handoff',
      workspaceId,
      eventId: `${data.conversationId}:handoff:${occurrenceId}`,
      occurredAt: nowIso(),
      data,
    };
  },

  dealCreated(workspaceId: string, data: DomainEventData<'deal.created'>): DomainEventDraft {
    return {
      event: 'deal.created',
      workspaceId,
      eventId: `${data.dealId}:created`,
      occurredAt: nowIso(),
      data,
    };
  },

  dealStageChanged(
    workspaceId: string,
    data: DomainEventData<'deal.stage_changed'>,
    occurrenceId: string = randomUUID(),
  ): DomainEventDraft {
    return {
      event: 'deal.stage_changed',
      workspaceId,
      eventId: `${data.dealId}:stage_changed:${occurrenceId}`,
      occurredAt: nowIso(),
      data,
    };
  },

  /**
   * Fechamento: a ocorrência é o instante gravado em `deals.closed_at` — reabrir e
   * fechar de novo é outra ocorrência; repetir o mesmo fechamento, não.
   */
  dealClosed(
    workspaceId: string,
    won: boolean,
    closedAt: Date,
    data: DomainEventData<'deal.won'>,
  ): DomainEventDraft {
    const event = won ? 'deal.won' : 'deal.lost';
    return {
      event,
      workspaceId,
      eventId: `${data.dealId}:${won ? 'won' : 'lost'}:${closedAt.getTime()}`,
      occurredAt: closedAt.toISOString(),
      data,
    };
  },

  conversionRegistered(
    workspaceId: string,
    data: DomainEventData<'conversion.registered'>,
  ): DomainEventDraft {
    return {
      event: 'conversion.registered',
      workspaceId,
      eventId: `${data.conversionId}:registered`,
      occurredAt: nowIso(),
      data,
    };
  },
} as const;

// ─── A partir das linhas do banco (um mapeamento, vários produtores) ──────────

/** Recorte estrutural de `deals` que os eventos de deal usam. */
export interface DealRowForEvent {
  readonly id: string;
  readonly pipelineId: string;
  readonly stageId: string;
  readonly contactId: string;
  readonly conversationId: string | null;
  readonly valueCents: number;
  readonly currency: string;
  readonly closedAt: Date | null;
}

/** Recorte estrutural de `conversion_events`. */
export interface ConversionRowForEvent {
  readonly id: string;
  readonly conversionTypeId: string;
  readonly contactId: string;
  readonly conversationId: string | null;
  readonly dealId: string | null;
  readonly valueCents: number | null;
  readonly currency: string;
  readonly source: string;
}

export function dealCreatedFromRow(workspaceId: string, deal: DealRowForEvent): DomainEventDraft {
  return domainEvents.dealCreated(workspaceId, {
    dealId: deal.id,
    pipelineId: deal.pipelineId,
    stageId: deal.stageId,
    contactId: deal.contactId,
    conversationId: deal.conversationId,
    valueCents: deal.valueCents,
    currency: deal.currency,
  });
}

/** Fechamento ganho/perdido. `null` se a linha não está fechada (defeito do caller). */
export function dealClosedFromRow(
  workspaceId: string,
  won: boolean,
  deal: DealRowForEvent,
): DomainEventDraft | null {
  if (deal.closedAt === null) return null;
  return domainEvents.dealClosed(workspaceId, won, deal.closedAt, {
    dealId: deal.id,
    pipelineId: deal.pipelineId,
    stageId: deal.stageId,
    contactId: deal.contactId,
    valueCents: deal.valueCents,
    currency: deal.currency,
  });
}

export function conversionRegisteredFromRow(
  workspaceId: string,
  row: ConversionRowForEvent,
): DomainEventDraft {
  return domainEvents.conversionRegistered(workspaceId, {
    conversionId: row.id,
    conversionTypeId: row.conversionTypeId,
    contactId: row.contactId,
    conversationId: row.conversationId,
    dealId: row.dealId,
    valueCents: row.valueCents,
    currency: row.currency,
    source: row.source,
  });
}

// ─── Emissor do processo (conexão preguiçosa, nunca lança) ────────────────────

/** Transporte substituível (teste): recebe a routing key e o envelope pronto. */
export type DomainEventTransport = (routingKey: string, envelope: Envelope) => Promise<void>;

let transportOverride: DomainEventTransport | null = null;
let handlePromise: Promise<MqHandle> | null = null;
let emitterLogger: RetryLogger | null = null;

/** Troca o transporte (testes). `null` volta ao RabbitMQ real. */
export function setDomainEventTransport(transport: DomainEventTransport | null): void {
  transportOverride = transport;
}

/** Logger estruturado do emissor (o processo configura no boot). */
export function setDomainEventLogger(logger: RetryLogger | null): void {
  emitterLogger = logger;
}

async function getHandle(): Promise<MqHandle> {
  handlePromise ??= connectMq();
  try {
    return await handlePromise;
  } catch (err) {
    handlePromise = null;
    throw err;
  }
}

function logEmitFailure(draft: DomainEventDraft, err: unknown): void {
  const fields = {
    event: draft.event,
    eventId: draft.eventId,
    workspaceId: draft.workspaceId,
    error: err instanceof Error ? err.message : String(err),
  };
  if (emitterLogger) {
    emitterLogger.error('domain event não publicado', fields);
    return;
  }
  console.error(JSON.stringify({ level: 'error', msg: 'domain event não publicado', ...fields }));
}

/**
 * Publica um evento de domínio. Chame DEPOIS do commit. Nunca lança: devolve
 * `false` e loga quando não conseguiu (broker fora, contrato violado).
 */
export async function emitDomainEvent(draft: DomainEventDraft): Promise<boolean> {
  try {
    const envelope = buildDomainEnvelope(draft);
    const routingKey = domainEventRoutingKey(draft.event);
    if (transportOverride) {
      await transportOverride(routingKey, envelope);
      return true;
    }
    const { channel } = await getHandle();
    await publishWithBackpressure(channel, routingKey, envelope);
    return true;
  } catch (err: unknown) {
    logEmitFailure(draft, err);
    return false;
  }
}

/** Publica vários em ordem (cada um isolado: um que falha não derruba os outros). */
export async function emitDomainEvents(drafts: readonly DomainEventDraft[]): Promise<void> {
  for (const draft of drafts) await emitDomainEvent(draft);
}

/** Fecha a conexão do emissor (shutdown/testes). */
export async function closeDomainEventEmitter(): Promise<void> {
  if (!handlePromise) return;
  const pending = handlePromise;
  handlePromise = null;
  try {
    const { connection } = await pending;
    await connection.close();
  } catch {
    // já caiu — nada a fazer
  }
}
