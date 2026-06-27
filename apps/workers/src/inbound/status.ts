/**
 * Read receipts / delivery status do WhatsApp (F1-S20, LIVECHAT.md §3.1/§6).
 *
 * O webhook Meta entrega os acks de entrega/leitura no MESMO payload das
 * mensagens, em `entry[].changes[].value.statuses[]` (distinto de `messages[]`).
 * O parser de `@hm/channels` já normaliza esse shape em `InboundEvent` do tipo
 * `'status'` (`{ provider, externalId, status, rawTimestamp }`) — então este
 * módulo trabalha sobre o evento JÁ parseado, não sobre o raw.
 *
 * Fluxo (espelha o worker de mídia, F1-S10 — UPDATE direto via `@hm/db`+RLS, só
 * o socket sai por MQ):
 *
 * ```
 * status event (externalId, status) + routing hints
 *   → resolve canal→workspace (cross-tenant, getDb() — ainda não há tenant)
 *   → withWorkspace(workspaceId): UPDATE messages.view_status (+ delivered_at /
 *     read_at / failed_reason) casando por external_id
 *   → emit message:status_changed em hm.q.socket.relay (room conversation:{id})
 * ```
 *
 * Idempotência e ordering: o WA pode entregar acks fora de ordem ou repetidos
 * (ex.: `delivered` depois de `read`). `view_status` é monotônico
 * (sent < delivered < read; `failed` é terminal e sempre vence): o UPDATE só
 * avança o status quando o novo rank é maior, então reprocessar/reordenar é
 * seguro (no-op quando não há avanço). Mensagem inexistente (ack chegou antes do
 * persist, ou de mensagem não rastreada) NÃO lança: loga-warn e retorna `skipped`.
 *
 * Fronteira de slot: este arquivo EXPORTA o handler + as portas default; o
 * orquestrador do worker inbound chama `handleStatusEvent` para cada
 * `InboundEvent` com `type === 'status'` (ver relatório do slot). Não edita
 * `pipeline.ts`/`worker.ts` (fora dos `files_allowed`).
 */
import { Buffer } from 'node:buffer';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb, schema, withWorkspace } from '@hm/db';
import { makeEnvelope, type MqHandle } from '@hm/shared/mq';
import type { ChannelProvider, ViewStatus } from '@hm/shared';
import type { InboundEvent } from '@hm/channels';
import type { Logger } from '@hm/logger';
import type { RoutingHints } from './ports';

/** Canal AMQP derivado de `@hm/shared/mq` (sem dep direta de `amqplib`). */
type MqChannel = MqHandle['channel'];

/** Fila de relay de socket (mesma constante de `apps/api/src/socket/relay.ts`). */
export const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

/** Status terminais do WA mapeados para `ViewStatus` (subconjunto de `@hm/shared`). */
export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

/**
 * Evento de status já parseado (subtipo `'status'` de `InboundEvent`). Extraído
 * para um alias nomeado para tipar o handler sem reabrir a união discriminada.
 */
export type InboundStatusEvent = Extract<InboundEvent, { type: 'status' }>;

/**
 * Entrada do handler de status: o evento parseado + as routing hints do raw
 * (necessárias para resolver canal→workspace, já que o evento não carrega
 * tenant — o webhook publica com workspace NIL).
 */
export interface StatusEventInput {
  readonly provider: ChannelProvider;
  readonly routing: RoutingHints;
  readonly event: InboundStatusEvent;
}

/** Resultado observável do handler (log/teste). */
export type StatusHandleResult =
  | { readonly outcome: 'updated'; readonly conversationId: string; readonly messageId: string }
  /**
   * F52-S04: o callback chegou ANTES do `external_id` ser persistido pelo worker
   * outbound (race conhecida). O status foi BUFFERIZADO (órfão de primeira
   * classe) keyed por `externalId` e será aplicado quando o `external_id`
   * aparecer (ver `finalize.ts`). Nunca se perde.
   */
  | { readonly outcome: 'buffered'; readonly externalId: string }
  | { readonly outcome: 'skipped'; readonly reason: StatusSkipReason };

/** Motivos de skip (todos ack'd — reprocessar payload imutável não ajuda). */
export type StatusSkipReason = 'channel_not_resolved' | 'message_not_found' | 'no_status_advance';

// ─── Mapeamento de status (exaustivo, monotônico) ─────────────────────────────

/**
 * Rank de progressão do receipt. `sent < delivered < read`; `failed` é terminal
 * e sempre vence (rank máximo). O UPDATE só avança quando o rank do novo status
 * é estritamente maior que o atual → idempotente e tolerante a reordenação.
 */
export const STATUS_RANK: Record<ViewStatus, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

/** Mapeia o status de entrega WA para `ViewStatus` (exaustivo). */
export function toViewStatus(status: DeliveryStatus): ViewStatus {
  switch (status) {
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'failed':
      return 'failed';
    default:
      return assertNever(status);
  }
}

function assertNever(value: never): never {
  throw new Error(`DeliveryStatus não tratado: ${JSON.stringify(value)}`);
}

// ─── Channel resolver (DB, cross-tenant) ──────────────────────────────────────

/** Canal resolvido a partir das routing hints (só o que o status precisa). */
export interface ResolvedStatusChannel {
  readonly workspaceId: string;
}

/**
 * Resolve o canal de destino (e, com ele, o tenant) a partir das routing hints.
 * É o passo que ainda não conhece o workspace, então roda com `getDb()` direto
 * (igual ao resolver de mídia / DB-owner do inbound). A partir daí toda query é
 * `withWorkspace` (RLS).
 */
export interface StatusChannelResolver {
  resolve(
    provider: ChannelProvider,
    routing: RoutingHints,
  ): Promise<ResolvedStatusChannel | null>;
}

/** Filtro de identidade do canal por provider (casa com as routing hints). */
function routingFilter(provider: ChannelProvider, routing: RoutingHints) {
  const { channels } = schema;
  switch (provider) {
    case 'meta_whatsapp':
      return routing.phoneNumberId !== undefined
        ? eq(channels.phoneNumberId, routing.phoneNumberId)
        : null;
    case 'meta_instagram':
      return routing.igUserId !== undefined ? eq(channels.igUserId, routing.igUserId) : null;
    case 'waha':
      return routing.wahaSession !== undefined
        ? eq(channels.wahaSessionId, routing.wahaSession)
        : null;
    default:
      return null;
  }
}

/** Resolver default DB-backed: lookup cross-tenant pelo identificador do canal. */
export class DbStatusChannelResolver implements StatusChannelResolver {
  async resolve(
    provider: ChannelProvider,
    routing: RoutingHints,
  ): Promise<ResolvedStatusChannel | null> {
    const filter = routingFilter(provider, routing);
    if (filter === null) return null;

    const { channels } = schema;
    const [row] = await getDb()
      .select({ workspaceId: channels.workspaceId })
      .from(channels)
      .where(and(eq(channels.provider, provider), eq(channels.isActive, true), filter))
      .limit(1);

    return row === undefined ? null : { workspaceId: row.workspaceId };
  }
}

// ─── Persistence (@hm/db + withWorkspace, RLS) ────────────────────────────────

/** Linha-alvo do UPDATE (resolvida por `external_id` dentro do tenant). */
export interface StatusMessageTarget {
  readonly messageId: string;
  readonly conversationId: string;
  /** Status anterior cru da coluna (para observabilidade no log). */
  readonly previousStatus: string;
}

/**
 * Persistência do receipt via `@hm/db`. Toda query roda dentro de
 * `withWorkspace(workspaceId, …)` (RLS). O UPDATE é condicional ao avanço de
 * rank (monotônico) e carimba `delivered_at`/`read_at`/`failed_reason` conforme
 * o status.
 */
export interface StatusPersistencePort {
  /**
   * Aplica o novo status à mensagem casada por `externalId`. Resultado
   * discriminado (F52-S04 — necessário para distinguir o callback órfão do
   * no-op monotônico):
   *  - `applied`   → houve avanço; carrega o alvo (`conversationId` p/ socket).
   *  - `no_advance`→ a mensagem existe mas o status não avança (idempotente).
   *  - `not_found` → NÃO existe mensagem com esse `externalId` (callback chegou
   *    antes do `external_id` ser persistido) → o caller BUFFERIZA o órfão.
   */
  applyStatus(input: {
    readonly workspaceId: string;
    readonly externalId: string;
    readonly status: ViewStatus;
    readonly at: Date;
  }): Promise<StatusApplyResult>;
}

/** Resultado discriminado de `applyStatus` (F52-S04). */
export type StatusApplyResult =
  | { readonly outcome: 'applied'; readonly target: StatusMessageTarget }
  | { readonly outcome: 'no_advance' }
  | { readonly outcome: 'not_found' };

/**
 * Estreita o `view_status` cru da coluna para o rank de progressão. A coluna
 * tem CHECK mais amplo que o `ViewStatus` de `@hm/shared` (`sending`/`deleted`):
 * `sending` é tratado como `pending` (recém-enviada, qualquer ack avança);
 * `deleted` retorna `undefined` e o caller aborta (nunca ressuscita uma
 * mensagem apagada). Qualquer valor desconhecido também aborta (fail-safe).
 */
function currentRankOf(raw: string): number | undefined {
  if (raw in STATUS_RANK) return STATUS_RANK[raw as ViewStatus];
  if (raw === 'sending') return STATUS_RANK.pending;
  return undefined;
}

/**
 * Decisão monotônica pura (F52-S04, reusada pelo worker outbound): dado o
 * `view_status` cru atual da coluna e um status entrante, devolve o novo status
 * SE houver avanço de rank (`sent<delivered<read`; `failed` vence), senão `null`
 * (no-op). `deleted`/desconhecido → `null` (nunca ressuscita uma mensagem
 * apagada). É a única fonte da verdade da progressão de status — testada em
 * isolamento e tolerante a acks fora de ordem/reprocessados.
 */
export function nextViewStatus(currentRaw: string, incoming: ViewStatus): ViewStatus | null {
  const cur = currentRankOf(currentRaw);
  if (cur === undefined) return null;
  return STATUS_RANK[incoming] > cur ? incoming : null;
}

/** Persistência default via `@hm/db` + RLS. */
export class DbStatusPersistence implements StatusPersistencePort {
  async applyStatus(input: {
    readonly workspaceId: string;
    readonly externalId: string;
    readonly status: ViewStatus;
    readonly at: Date;
  }): Promise<StatusApplyResult> {
    const { messages } = schema;

    return withWorkspace(input.workspaceId, async (tx) => {
      const [current] = await tx
        .select({
          id: messages.id,
          conversationId: messages.conversationId,
          viewStatus: messages.viewStatus,
        })
        .from(messages)
        .where(and(eq(messages.externalId, input.externalId), isNull(messages.deletedAt)))
        .limit(1);

      // Mensagem inexistente p/ esse externalId → callback chegou antes do
      // worker outbound gravar o external_id (race). NÃO descarta: o caller
      // bufferiza o órfão.
      if (current === undefined) return { outcome: 'not_found' };

      // Monotônico (sent<delivered<read; failed vence): só avança. `deleted`/
      // desconhecido → null (nunca ressuscita). Tolerante a acks fora de ordem.
      const advanced = nextViewStatus(current.viewStatus, input.status);
      if (advanced === null) return { outcome: 'no_advance' };

      await tx
        .update(messages)
        .set({
          viewStatus: advanced,
          ...(advanced === 'delivered' ? { deliveredAt: input.at } : {}),
          ...(advanced === 'read' ? { readAt: input.at } : {}),
          ...(advanced === 'failed' ? { failedReason: 'channel_status_failed' } : {}),
          updatedAt: input.at,
        })
        .where(eq(messages.id, current.id));

      return {
        outcome: 'applied',
        target: {
          messageId: current.id,
          conversationId: current.conversationId,
          previousStatus: current.viewStatus,
        },
      };
    });
  }
}

// ─── Orphan status store (F52-S04, buffer cross-process) ──────────────────────

/** True quando há `DATABASE_URL` — fora disso (testes unit puros) o store no-opa. */
function dbConfigured(): boolean {
  const url = process.env['DATABASE_URL'];
  return typeof url === 'string' && url.length > 0;
}

/**
 * Status de entrega cujo `external_id` ainda NÃO existe em `messages` (callback
 * tardio). Keyed por `externalId` (= wamid/mid). Buffer de primeira classe,
 * cross-process (inbound worker escreve; outbound worker drena no `finalize`).
 */
export interface OrphanStatusRecord {
  readonly externalId: string;
  readonly status: ViewStatus;
  readonly at: Date;
}

/**
 * Porta do buffer de status órfão. A implementação default persiste em
 * `webhook_events` (tabela platform-level já existente) sob um provider
 * SENTINELA, sem colidir com a dedup de webhooks (chave namespaced). Mantém só
 * o status de MAIOR rank por `externalId` (monotônico mesmo no buffer).
 */
export interface OrphanStatusStore {
  /** Bufferiza (upsert) o status órfão, preservando o de maior rank. */
  record(input: OrphanStatusRecord): Promise<void>;
  /** Lê+remove (atômico) o status bufferizado para um `externalId`, ou `null`. */
  drain(externalId: string): Promise<OrphanStatusRecord | null>;
}

/**
 * Provider sentinela em `webhook_events` para os registros de status órfão.
 * Garante chave `(provider, external_event_id)` disjunta da dedup real de
 * webhooks (que usa o provider real) — zero colisão.
 */
const ORPHAN_PROVIDER_SENTINEL = '__orphan_outbound_status';

function parseOrphanPayload(externalId: string, raw: Record<string, unknown>): OrphanStatusRecord | null {
  const status = raw['status'];
  if (typeof status !== 'string' || !(status in STATUS_RANK)) return null;
  const at = raw['at'];
  const date = typeof at === 'string' ? new Date(at) : new Date();
  return {
    externalId,
    status: status as ViewStatus,
    at: Number.isNaN(date.getTime()) ? new Date() : date,
  };
}

/** Store default: `webhook_events` (platform-level, sem RLS → `getDb()`). */
export class DbOrphanStatusStore implements OrphanStatusStore {
  async record(input: OrphanStatusRecord): Promise<void> {
    if (!dbConfigured()) return;
    const { webhookEvents } = schema;
    const rank = STATUS_RANK[input.status];
    const rawPayload: Record<string, unknown> = {
      status: input.status,
      at: input.at.toISOString(),
      rank,
    };
    await getDb()
      .insert(webhookEvents)
      .values({
        provider: ORPHAN_PROVIDER_SENTINEL,
        externalEventId: input.externalId,
        rawPayload,
      })
      .onConflictDoUpdate({
        target: [webhookEvents.provider, webhookEvents.externalEventId],
        set: { rawPayload, receivedAt: new Date() },
        // Só sobrescreve se o órfão entrante tem rank MAIOR (monotônico no buffer
        // — tolera acks fora de ordem antes da reconciliação).
        setWhere: sql`(${webhookEvents.rawPayload} ->> 'rank')::int < ${rank}`,
      });
  }

  async drain(externalId: string): Promise<OrphanStatusRecord | null> {
    if (!dbConfigured()) return null;
    const { webhookEvents } = schema;
    const rows = await getDb()
      .delete(webhookEvents)
      .where(
        and(
          eq(webhookEvents.provider, ORPHAN_PROVIDER_SENTINEL),
          eq(webhookEvents.externalEventId, externalId),
        ),
      )
      .returning({ rawPayload: webhookEvents.rawPayload });
    const row = rows[0];
    if (row === undefined) return null;
    return parseOrphanPayload(externalId, row.rawPayload);
  }
}

/** Instância default compartilhada (worker inbound + finalize outbound). */
export const defaultOrphanStatusStore: OrphanStatusStore = new DbOrphanStatusStore();

// ─── Socket (MQ relay) ────────────────────────────────────────────────────────

/** Payload de emissão do receipt (mapeia `message:status_changed`). */
export interface StatusEmitInput {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly status: ViewStatus;
}

/**
 * Emissão de socket via fila de relay. O payload espelha o contrato de
 * `relay.ts`: `{ event, target: { conversationId }, data }` → room
 * `conversation:{id}`.
 */
export interface StatusSocketPort {
  emitStatusChanged(input: StatusEmitInput): Promise<void>;
}

/** Implementação default: publica no `hm.q.socket.relay` (consumido por `relay.ts`). */
export class MqStatusSocketEmit implements StatusSocketPort {
  constructor(private readonly channel: MqChannel) {}

  async emitStatusChanged(input: StatusEmitInput): Promise<void> {
    const envelope = makeEnvelope('socket.relay', input.workspaceId, {
      event: 'message:status_changed',
      target: { conversationId: input.conversationId },
      data: {
        conversationId: input.conversationId,
        messageId: input.messageId,
        status: input.status,
      },
    });
    this.channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      contentType: 'application/json',
    });
    await Promise.resolve();
  }
}

// ─── Deps + handler ───────────────────────────────────────────────────────────

/** Dependências do handler de status (injetáveis e testáveis). */
export interface StatusDeps {
  readonly channels: StatusChannelResolver;
  readonly persistence: StatusPersistencePort;
  readonly socket: StatusSocketPort;
  /** F52-S04: buffer de status órfão (callback antes do external_id). */
  readonly orphan: OrphanStatusStore;
}

/**
 * Monta as deps default a partir da infra real: resolver DB-backed, persistência
 * `@hm/db`+RLS e socket via fila de relay. O `channel` AMQP é o do worker
 * inbound (mesma conexão).
 */
export function createStatusDeps(channel: MqChannel): StatusDeps {
  return {
    channels: new DbStatusChannelResolver(),
    persistence: new DbStatusPersistence(),
    socket: new MqStatusSocketEmit(channel),
    orphan: defaultOrphanStatusStore,
  };
}

function toDate(rawTimestamp: string): Date {
  const date = new Date(rawTimestamp);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/**
 * Processa um único evento de status (delivery/read receipt). Idempotente e
 * tolerante a reordenação (UPDATE monotônico). Conteúdo morto (canal não
 * resolvido, mensagem inexistente, status sem avanço) NÃO lança: loga-warn e
 * retorna `skipped` — o caller faz ack. Só falha de infra (DB/socket) propaga
 * para o caller converter em nack→DLX.
 */
export async function handleStatusEvent(
  input: StatusEventInput,
  deps: StatusDeps,
  logger: Logger,
): Promise<StatusHandleResult> {
  const { provider, routing, event } = input;
  const status = toViewStatus(event.status);

  const channel = await deps.channels.resolve(provider, routing);
  if (channel === null) {
    logger.warn('status: canal não resolvido pelas routing hints — descartado', {
      provider,
      externalId: event.externalId,
    });
    return { outcome: 'skipped', reason: 'channel_not_resolved' };
  }

  const at = toDate(event.rawTimestamp);
  const applied = await deps.persistence.applyStatus({
    workspaceId: channel.workspaceId,
    externalId: event.externalId,
    status,
    at,
  });

  // F52-S04: callback chegou antes do external_id ser persistido → bufferiza o
  // órfão keyed por externalId (será aplicado no finalize do worker outbound).
  // Status NUNCA se perde.
  if (applied.outcome === 'not_found') {
    await deps.orphan.record({ externalId: event.externalId, status, at });
    logger.info('status: callback antes do external_id persistir — bufferizado (órfão)', {
      provider,
      externalId: event.externalId,
      status,
    });
    return { outcome: 'buffered', externalId: event.externalId };
  }

  if (applied.outcome === 'no_advance') {
    logger.warn('status: status sem avanço — descartado (monotônico)', {
      provider,
      externalId: event.externalId,
      status,
    });
    return { outcome: 'skipped', reason: 'no_status_advance' };
  }

  const { target } = applied;
  await deps.socket.emitStatusChanged({
    workspaceId: channel.workspaceId,
    conversationId: target.conversationId,
    messageId: target.messageId,
    status,
  });

  logger.info('status: view_status atualizado', {
    provider,
    conversationId: target.conversationId,
    messageId: target.messageId,
    from: target.previousStatus,
    to: status,
  });

  return { outcome: 'updated', conversationId: target.conversationId, messageId: target.messageId };
}
