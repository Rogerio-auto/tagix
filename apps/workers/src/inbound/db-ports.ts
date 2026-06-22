/**
 * Persistência direta (`@hm/db` + `withWorkspace`/RLS) do pipeline inbound
 * (F1-S26, ARCHITECTURE.md §4.2, LIVECHAT.md §1/§3, DATA_MODEL §5/§6).
 *
 * Espelha o estilo do worker de mídia (`media/adapters.ts`): resolução de
 * canal→workspace cross-tenant via `getDb()` (é o passo que descobre o tenant,
 * então ainda não há `workspaceId` para escopar RLS) e, a partir daí, TODA
 * mutação roda dentro de `withWorkspace(workspaceId, …)` → `SET LOCAL` de tenant
 * + role `hm_app`.
 *
 * Sequência por requisição (um envelope de webhook → N eventos do mesmo canal):
 *
 * ```
 * resolve channel→workspace (routing hints)         [getDb(), cross-tenant]
 *   withWorkspace(workspaceId):
 *     ensure contact   (upsert por workspace+remoteId)
 *     ensure conversation (upsert por uq_conversations_channel_remote)
 *     para cada message event:
 *       insert message  (onConflictDoNothing em uq_messages_external → dedup)
 *       se inserida: acumula em last_message/unread
 *     update conversations.last_message_* + unread_count   (uma vez)
 *     bump cache version (conversations.updated_at)
 *   emit message:new por mensagem inserida   (room conversation:{id})
 * status events → handleStatusEvent (S20, fora do withWorkspace: resolve próprio)
 * presence (typing do contato) → emitContactPresence (S21)
 * ai_mode='on' → enqueue flow/agent (STUB — ver REPORT)
 * ```
 *
 * Idempotência: reprocessar o mesmo envelope é seguro. O dedup por
 * `uq_messages_external (conversation_id, external_id)` (`onConflictDoNothing`)
 * garante que mensagens repetidas não dupliquem nem reemitam `message:new`, e o
 * upsert de contact/conversation é estável.
 */
import { Buffer } from 'node:buffer';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb, pickAutoAssignee, schema, withWorkspace } from '@hm/db';
import { makeEnvelope, type MqHandle } from '@hm/shared/mq';
import type {
  ChannelProvider,
  ContactPresence,
  ConversationAssignedPayload,
  ServerToClientEvent,
  TypingFromContactPayload,
} from '@hm/shared';
import type { InboundEvent } from '@hm/channels';
import type { DbTx } from '@hm/db';
import type { Logger } from '@hm/logger';
import { handleStatusEvent, type InboundStatusEvent, type StatusDeps } from './status';
import { emitContactPresence, type ContactPresenceEmitPort } from '../outbound/presence';
import type {
  AutoAssignAutomatic,
  AutoAssignPick,
  InboundAutoAssignPort,
  InboundPersistencePort,
  PersistInboundRequest,
  PersistInboundResult,
  RoutingHints,
} from './ports';

/** Canal AMQP derivado de `@hm/shared/mq` (sem dep direta de `amqplib`). */
type MqChannel = MqHandle['channel'];

/** Fila de relay de socket (mesma constante de `apps/api/src/socket/relay.ts`). */
export const SOCKET_RELAY_QUEUE = 'hm.q.socket.relay' as const;

/** Fila canônica de flows (`QUEUES.flows`). */
export const FLOWS_QUEUE = 'hm.q.flows' as const;

/** Eventos `message` de uma requisição (o que vira linha em `messages`). */
type InboundMessageEvent = Extract<InboundEvent, { type: 'message' }>;

/** Eventos `comment` IG (linha em ig_comments + comment_thread). */
type InboundCommentEvent = Extract<InboundEvent, { type: 'comment' }>;

// ─── Channel resolver (DB, cross-tenant) ──────────────────────────────────────

/** Canal resolvido a partir das routing hints (o que a persistência precisa). */
export interface ResolvedInboundChannel {
  readonly channelId: string;
  readonly workspaceId: string;
}

/**
 * Resolve channel→workspace a partir das routing hints. Lookup cross-tenant por
 * `phone_number_id`/`ig_user_id`/`waha_session_id` (índices únicos) com
 * `getDb()` direto — é o passo que descobre o tenant.
 */
export interface InboundChannelResolver {
  resolve(provider: ChannelProvider, routing: RoutingHints): Promise<ResolvedInboundChannel | null>;
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
export class DbInboundChannelResolver implements InboundChannelResolver {
  async resolve(
    provider: ChannelProvider,
    routing: RoutingHints,
  ): Promise<ResolvedInboundChannel | null> {
    const filter = routingFilter(provider, routing);
    if (filter === null) return null;

    const { channels } = schema;
    const [row] = await getDb()
      .select({ id: channels.id, workspaceId: channels.workspaceId })
      .from(channels)
      .where(and(eq(channels.provider, provider), eq(channels.isActive, true), filter))
      .limit(1);

    return row === undefined ? null : { channelId: row.id, workspaceId: row.workspaceId };
  }
}

// ─── Socket (MQ relay) ────────────────────────────────────────────────────────

/** Dados do `message:new` (room `conversation:{id}`). */
export interface InboundMessageNewEmit {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly externalId: string;
  readonly type: string;
  readonly content: string | null;
}

/**
 * Porta de socket do inbound: emite `message:new`, `typing:from_contact`
 * (presença do contato, S21) e `conversation:assigned` (F30-S09).
 * Implementação default publica no `hm.q.socket.relay` (consumido por `relay.ts`).
 */
export interface InboundSocketPort extends ContactPresenceEmitPort {
  emitMessageNew(input: InboundMessageNewEmit): Promise<void>;
  /** Emite `conversation:assigned` ao workspace (F30-S09). */
  emitConversationAssigned(
    workspaceId: string,
    payload: ConversationAssignedPayload,
  ): Promise<void>;
}

/** Publica `{ event, target:{conversationId}, data }` no relay → room conversation:{id}. */
function relayEnvelope(
  channel: MqChannel,
  workspaceId: string,
  event: ServerToClientEvent,
  conversationId: string,
  data: unknown,
  opts?: { readonly workspace?: boolean },
): void {
  const target = opts?.workspace === true ? { conversationId, workspace: true } : { conversationId };
  const envelope = makeEnvelope('socket.relay', workspaceId, {
    event,
    target,
    data,
  });
  channel.sendToQueue(SOCKET_RELAY_QUEUE, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    contentType: 'application/json',
  });
}

/** Implementação default: relay via `hm.q.socket.relay`. */
export class MqInboundSocketEmit implements InboundSocketPort {
  constructor(private readonly channel: MqChannel) {}

  async emitMessageNew(input: InboundMessageNewEmit): Promise<void> {
    relayEnvelope(this.channel, input.workspaceId, 'message:new', input.conversationId, {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      message: {
        id: input.messageId,
        conversationId: input.conversationId,
        externalId: input.externalId,
        type: input.type,
        content: input.content,
        direction: 'inbound',
      },
      // `workspace: true` → o relay emite também para `ws:{workspaceId}`, não só
      // para a sala da conversa. Sem isto, uma conversa NOVA (que ninguém abriu
      // ainda) não aparecia na lista ao vivo (ninguém está na sala dela). Assim a
      // ChatList (que escuta o socket do workspace) atualiza sozinha.
    }, { workspace: true });
    await Promise.resolve();
  }

  async emitContactPresence(workspaceId: string, payload: TypingFromContactPayload): Promise<void> {
    relayEnvelope(
      this.channel,
      workspaceId,
      'typing:from_contact',
      payload.conversationId,
      payload,
    );
    await Promise.resolve();
  }

  async emitConversationAssigned(
    workspaceId: string,
    payload: ConversationAssignedPayload,
  ): Promise<void> {
    relayEnvelope(
      this.channel,
      workspaceId,
      'conversation:assigned',
      payload.conversationId,
      payload,
      { workspace: true },
    );
    await Promise.resolve();
  }
}

// ─── Flow/agent enqueue (ai_mode='on') — STUB provisório ──────────────────────

/** Contexto mínimo para disparar um agent/flow numa conversa com IA ligada. */
export interface InboundFlowTrigger {
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly channelId: string;
  readonly provider: ChannelProvider;
  /** `externalId` da última mensagem inbound desta requisição (gatilho). */
  readonly lastInboundExternalId: string;
}

/**
 * Porta de disparo de agent/flow quando `conversations.ai_mode = 'on'`. O
 * contrato do consumer de `hm.q.flows` ainda NÃO existe (F2/flow-engine — ver
 * REPORT): a impl. default publica um envelope `flow.run.requested` provisório
 * e injetável; até o consumer existir, é efetivamente um no-op downstream.
 */
export interface InboundFlowEnqueuePort {
  enqueue(trigger: InboundFlowTrigger): Promise<void>;
}

/** Tipo do envelope provisório de disparo de flow (discriminado pelo consumer F2). */
export const INBOUND_FLOW_TYPE = 'flow.run.requested' as const;

/**
 * Enfileiramento default via `hm.q.flows`. **STUB**: o shape do payload é
 * provisório e será firmado quando o flow-worker (F2) definir seu contrato.
 */
export class MqInboundFlowEnqueue implements InboundFlowEnqueuePort {
  constructor(private readonly channel: MqChannel) {}

  async enqueue(trigger: InboundFlowTrigger): Promise<void> {
    const envelope = makeEnvelope(INBOUND_FLOW_TYPE, trigger.workspaceId, {
      conversationId: trigger.conversationId,
      contactId: trigger.contactId,
      channelId: trigger.channelId,
      provider: trigger.provider,
      triggerExternalId: trigger.lastInboundExternalId,
    });
    this.channel.sendToQueue(FLOWS_QUEUE, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      contentType: 'application/json',
    });
    await Promise.resolve();
  }
}

// ─── Auto-assign (F30-S09) ────────────────────────────────────────────────────

/**
 * Implementação default do picker de auto-assign: delega para `pickAutoAssignee`
 * do repo `@hm/db` (round_robin/least_busy via SQL; `manual` → null).
 * Injetável para teste sem DB.
 */
export class DbInboundAutoAssign implements InboundAutoAssignPort {
  async pick(input: AutoAssignPick): Promise<string | null> {
    return pickAutoAssignee({ teamId: input.teamId, strategy: input.strategy });
  }
}

// ─── Persistence (@hm/db + withWorkspace, RLS) ────────────────────────────────

/** Snapshot do contato/conversa resolvido dentro do tenant. */
interface ResolvedConversation {
  readonly contactId: string;
  readonly conversationId: string;
  readonly aiMode: string;
  /** `assigned_to` no momento do upsert; null se não atribuída. */
  readonly assignedTo: string | null;
  /** `team_id` da conversa; null se sem time. */
  readonly teamId: string | null;
}

/** Linha inserida em `messages` (para o socket pós-persist). */
interface InsertedMessage {
  readonly messageId: string;
  readonly externalId: string;
  readonly type: string;
  readonly content: string | null;
}

/** Preview curto da última mensagem (texto ou rótulo do tipo de mídia). */
function previewOf(event: InboundMessageEvent): string {
  if (typeof event.content === 'string' && event.content.length > 0) {
    return event.content.slice(0, 280);
  }
  return `[${event.messageType}]`;
}

function toDate(rawTimestamp: string): Date {
  const date = new Date(rawTimestamp);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/**
 * Persistência default do inbound via `@hm/db`. Resolve channel→workspace e
 * aplica todo o trecho DB-bound sob RLS. Recebe as portas de socket/flow por
 * injeção (composição em `createInboundDeps`).
 */
/**
 * Hook opcional disparado por mensagem INBOUND DO CONTATO persistida (F4-S13). O
 * trigger dispatcher de flows pluga aqui para avaliar/disparar flows e retomar
 * execucoes waiting. Opcional: ausente = comportamento F1 inalterado.
 */
export interface InboundContactMessageHook {
  onContactMessage(input: {
    workspaceId: string;
    conversationId: string;
    contactId: string | null;
    channelId: string;
    messageId: string;
    type: string;
    content: string | null;
  }): Promise<void>;
}

export class DbInboundPersistence implements InboundPersistencePort {
  constructor(
    private readonly socket: InboundSocketPort,
    private readonly flow: InboundFlowEnqueuePort,
    private readonly statusDeps: StatusDeps,
    private readonly logger: Logger,
    private readonly channels: InboundChannelResolver = new DbInboundChannelResolver(),
    private readonly contactMessageHook?: InboundContactMessageHook,
    private readonly autoAssign: InboundAutoAssignPort = new DbInboundAutoAssign(),
  ) {}

  async persist(request: PersistInboundRequest): Promise<PersistInboundResult> {
    const { provider, routing, events } = request;

    const messageEvents = events.filter((e): e is InboundMessageEvent => e.type === 'message');
    const statusEvents = events.filter((e): e is InboundStatusEvent => e.type === 'status');
    const reactionEvents = events.filter((e) => e.type === 'reaction');
    const commentEvents = events.filter(
      (e): e is InboundCommentEvent => e.type === 'comment',
    );

    // Status (S20): cada um resolve o próprio canal/tenant — independe da
    // existência de canal para as mensagens (acks podem chegar isolados).
    let statuses = 0;
    for (const event of statusEvents) {
      await handleStatusEvent({ provider, routing, event }, this.statusDeps, this.logger);
      statuses += 1;
    }

    // Sem mensagens, comments nem reações a persistir → só os status acima.
    if (messageEvents.length === 0 && reactionEvents.length === 0 && commentEvents.length === 0) {
      return { inserted: 0, deduped: 0, statuses, resolved: true };
    }

    const channel = await this.channels.resolve(provider, routing);
    if (channel === null) {
      this.logger.warn('inbound: canal não resolvido pelas routing hints — descartado', {
        provider,
      });
      return { inserted: 0, deduped: 0, statuses, resolved: false };
    }

    const { channelId, workspaceId } = channel;

    // F15-S03: persiste comments IG (ig_comments + comment_thread) — independem
    // de um message anchor de DM.
    let commentsInserted = 0;
    for (const comment of commentEvents) {
      const ok = await this.persistComment(workspaceId, channelId, comment);
      if (ok) commentsInserted += 1;
    }
    if (messageEvents.length === 0 && reactionEvents.length === 0) {
      return { inserted: commentsInserted, deduped: 0, statuses, resolved: true };
    }

    // Remote id do contato/conversa (estável por canal). Toda mensagem de um
    // envelope vem do mesmo contato; usamos o primeiro evento como âncora.
    const anchor = messageEvents[0];
    if (anchor === undefined) {
      // Só reações (sem mensagem): nada a inserir nesta fase (F1 não persiste
      // reações como linha própria — ver REPORT). Ack silencioso.
      return { inserted: 0, deduped: 0, statuses, resolved: true };
    }
    const remoteId = anchor.contactRemoteId;

    const autoAssignPort = this.autoAssign;
    const outcome = await withWorkspace(workspaceId, async (tx) => {
      const resolved = await ensureConversation(tx, workspaceId, channelId, remoteId);
      const inserted = await insertMessages(
        tx,
        workspaceId,
        resolved.conversationId,
        messageEvents,
      );
      if (inserted.length > 0) {
        await bumpConversation(tx, resolved.conversationId, messageEvents, inserted.length);
      }

      // F30-S09: auto-assign quando a conversa está sem owner e o time-alvo tem
      // estratégia automática. Só tenta na primeira vez (assignedTo === null).
      let autoAssignedTo: string | null = null;
      if (resolved.assignedTo === null && resolved.teamId !== null) {
        const teamRow = await tx
          .select({ strategy: schema.teams.autoAssignStrategy })
          .from(schema.teams)
          .where(eq(schema.teams.id, resolved.teamId))
          .limit(1);
        const strategy = teamRow[0]?.strategy ?? 'manual';
        if (strategy !== 'manual') {
          const assignee = await autoAssignPort.pick({
            teamId: resolved.teamId,
            strategy: strategy as AutoAssignAutomatic,
          });
          if (assignee !== null) {
            await tx
              .update(schema.conversations)
              .set({ assignedTo: assignee })
              .where(eq(schema.conversations.id, resolved.conversationId));
            await tx.insert(schema.routingHistory).values({
              workspaceId,
              conversationId: resolved.conversationId,
              action: 'auto_assign',
              toMemberId: assignee,
            });
            autoAssignedTo = assignee;
          }
        }
      }

      return { resolved, inserted, autoAssignedTo };
    });

    // F30-S09: emite conversation:assigned ao workspace quando auto-assign ocorreu.
    if (outcome.autoAssignedTo !== null) {
      await this.socket.emitConversationAssigned(workspaceId, {
        conversationId: outcome.resolved.conversationId,
        assignedTo: outcome.autoAssignedTo,
      });
    }

    // Pós-persist (fora da transação): socket + flow conhecem os UUIDs.
    for (const msg of outcome.inserted) {
      await this.socket.emitMessageNew({
        workspaceId,
        conversationId: outcome.resolved.conversationId,
        messageId: msg.messageId,
        externalId: msg.externalId,
        type: msg.type,
        content: msg.content,
      });
    }

    // Trigger dispatcher de flows (F4-S13): avalia/dispara flows e retoma waiting por
    // mensagem do contato. Hook opcional — so inbound dispara triggers (secao 5.1).
    if (this.contactMessageHook && outcome.inserted.length > 0) {
      for (const msg of outcome.inserted) {
        try {
          await this.contactMessageHook.onContactMessage({
            workspaceId,
            conversationId: outcome.resolved.conversationId,
            contactId: outcome.resolved.contactId,
            channelId,
            messageId: msg.messageId,
            type: msg.type,
            content: msg.content,
          });
        } catch (err: unknown) {
          // Falha de trigger nao deve derrubar a persistencia inbound.
          this.logger.error('inbound: trigger dispatch de flows falhou', {
            conversationId: outcome.resolved.conversationId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    if (outcome.inserted.length > 0 && outcome.resolved.aiMode === 'on') {
      const last = messageEvents[messageEvents.length - 1];
      await this.flow.enqueue({
        workspaceId,
        conversationId: outcome.resolved.conversationId,
        contactId: outcome.resolved.contactId,
        channelId,
        provider,
        lastInboundExternalId: last?.externalId ?? anchor.externalId,
      });
    }

    return {
      inserted: outcome.inserted.length,
      deduped: messageEvents.length - outcome.inserted.length,
      statuses,
      resolved: true,
    };
  }

  /**
   * Persiste um comment IG (F15-S03): upsert em `ig_comments` (dedup por
   * channel+commentId), conversa kind='comment_thread' (uma por media_id x
   * contato, via remoteId = "media:igsid"), uma linha `messages` type='comment'
   * linkando o comment em metadata, e emite message:new. Idempotente.
   * Retorna true se uma nova linha de mensagem foi inserida.
   */
  private async persistComment(
    workspaceId: string,
    channelId: string,
    comment: InboundCommentEvent,
  ): Promise<boolean> {
    const { igComments, conversations, messages } = schema;
    // remoteId estavel da thread: media + autor (uma conversa por post x contato).
    const remoteId = 'cmt:' + comment.mediaId + ':' + comment.fromIgsId;

    const result = await withWorkspace(workspaceId, async (tx) => {
      // 1) Upsert ig_comments (dedup por uq_ig_comments_channel_comment).
      await tx
        .insert(igComments)
        .values({
          workspaceId,
          channelId,
          mediaId: comment.mediaId,
          commentId: comment.commentId,
          ...(comment.parentCommentId !== undefined
            ? { parentCommentId: comment.parentCommentId }
            : {}),
          fromIgsid: comment.fromIgsId,
          ...(comment.fromUsername !== undefined ? { fromUsername: comment.fromUsername } : {}),
          ...(comment.text !== undefined ? { text: comment.text } : {}),
          ...(comment.mediaKind !== undefined ? { mediaKind: comment.mediaKind } : {}),
        })
        .onConflictDoNothing({ target: [igComments.channelId, igComments.commentId] });

      // 2) Conversa comment_thread (upsert por channel+remoteId).
      const contactId = await ensureContact(tx, workspaceId, comment.fromIgsId);
      const [existingConv] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.channelId, channelId), eq(conversations.remoteId, remoteId)))
        .limit(1);

      let conversationId: string;
      if (existingConv !== undefined) {
        conversationId = existingConv.id;
      } else {
        const [created] = await tx
          .insert(conversations)
          .values({
            workspaceId,
            channelId,
            contactId,
            remoteId,
            kind: 'comment_thread',
            status: 'open',
            aiMode: 'off',
          })
          .onConflictDoNothing({ target: [conversations.channelId, conversations.remoteId] })
          .returning({ id: conversations.id });
        if (created !== undefined) {
          conversationId = created.id;
        } else {
          const [row] = await tx
            .select({ id: conversations.id })
            .from(conversations)
            .where(and(eq(conversations.channelId, channelId), eq(conversations.remoteId, remoteId)))
            .limit(1);
          if (row === undefined) {
            throw new Error('inbound: comment_thread nao materializou.');
          }
          conversationId = row.id;
        }
      }

      // 3) Linha messages type='comment' (dedup por uq_messages_external).
      const [msg] = await tx
        .insert(messages)
        .values({
          workspaceId,
          conversationId,
          externalId: comment.commentId,
          direction: 'inbound',
          senderType: 'contact',
          type: 'comment',
          content: comment.text ?? null,
          viewStatus: 'delivered',
          metadata: {
            commentId: comment.commentId,
            mediaId: comment.mediaId,
            ...(comment.parentCommentId !== undefined
              ? { parentCommentId: comment.parentCommentId }
              : {}),
            ...(comment.fromUsername !== undefined ? { fromUsername: comment.fromUsername } : {}),
          },
        })
        .onConflictDoNothing({
        target: [messages.conversationId, messages.externalId],
        // `uq_messages_external` é PARCIAL (WHERE external_id IS NOT NULL). O ON
        // CONFLICT só casa um índice parcial repetindo o predicado — sem isto o
        // Postgres rejeita ("no unique constraint matching") e a mensagem some.
        where: sql`${messages.externalId} is not null`,
      })
        .returning({ id: messages.id });

      if (msg !== undefined) {
        await tx
          .update(conversations)
          .set({
            lastMessagePreview: (comment.text ?? '[comentario]').slice(0, 280),
            lastMessageAt: new Date(),
            lastMessageFrom: 'contact',
            unreadCount: sql`${conversations.unreadCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, conversationId));
      }

      return { conversationId, messageId: msg?.id };
    });

    if (result.messageId === undefined) return false;

    await this.socket.emitMessageNew({
      workspaceId,
      conversationId: result.conversationId,
      messageId: result.messageId,
      externalId: comment.commentId,
      type: 'comment',
      content: comment.text ?? null,
    });
    return true;
  }

  /**
   * Emite presença "digitando…" do CONTATO (S21). O pipeline chama isto quando
   * um provider sinaliza presença; resolve a conversa pelo canal+remoteId e
   * delega ao helper de `presence.ts`. Best-effort (presença é cosmética).
   */
  async emitContactPresenceFor(
    provider: ChannelProvider,
    routing: RoutingHints,
    contactRemoteId: string,
    presence: ContactPresence,
  ): Promise<boolean> {
    const channel = await this.channels.resolve(provider, routing);
    if (channel === null) return false;
    const { channelId, workspaceId } = channel;

    const conversationId = await withWorkspace(workspaceId, async (tx) => {
      const { conversations } = schema;
      const [row] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(eq(conversations.channelId, channelId), eq(conversations.remoteId, contactRemoteId)),
        )
        .limit(1);
      return row?.id ?? null;
    });

    if (conversationId === null) return false;
    await emitContactPresence(this.socket, workspaceId, conversationId, presence);
    return true;
  }
}

// ─── Upsert helpers (rodam DENTRO de withWorkspace) ───────────────────────────

/**
 * Garante contato + conversa do par (canal, remoteId). Upsert idempotente: o
 * contato é casado por (workspace, phone) quando há telefone, senão criado; a
 * conversa por `uq_conversations_channel_remote (channel_id, remote_id)`.
 */
async function ensureConversation(
  tx: DbTx,
  workspaceId: string,
  channelId: string,
  remoteId: string,
): Promise<ResolvedConversation> {
  const { conversations } = schema;

  // 1) Conversa já existe? (caminho quente — a maioria das mensagens).
  const [existing] = await tx
    .select({
      id: conversations.id,
      contactId: conversations.contactId,
      aiMode: conversations.aiMode,
      assignedTo: conversations.assignedTo,
      teamId: conversations.teamId,
    })
    .from(conversations)
    .where(and(eq(conversations.channelId, channelId), eq(conversations.remoteId, remoteId)))
    .limit(1);

  if (existing !== undefined) {
    const contactId = existing.contactId ?? (await ensureContact(tx, workspaceId, remoteId));
    if (existing.contactId === null) {
      await tx.update(conversations).set({ contactId }).where(eq(conversations.id, existing.id));
    }
    return {
      contactId,
      conversationId: existing.id,
      aiMode: existing.aiMode,
      assignedTo: existing.assignedTo ?? null,
      teamId: existing.teamId ?? null,
    };
  }

  // 2) Cria contato + conversa. Race entre dois consumidores do mesmo envelope é
  //    coberta pelo `onConflictDoNothing` na conversa (índice único) + reselect.
  const contactId = await ensureContact(tx, workspaceId, remoteId);

  const [created] = await tx
    .insert(conversations)
    .values({
      workspaceId,
      channelId,
      contactId,
      remoteId,
      kind: 'direct',
      status: 'open',
      aiMode: 'off',
    })
    .onConflictDoNothing({ target: [conversations.channelId, conversations.remoteId] })
    .returning({
      id: conversations.id,
      aiMode: conversations.aiMode,
      assignedTo: conversations.assignedTo,
      teamId: conversations.teamId,
    });

  if (created !== undefined) {
    return {
      contactId,
      conversationId: created.id,
      aiMode: created.aiMode,
      assignedTo: created.assignedTo ?? null,
      teamId: created.teamId ?? null,
    };
  }

  // Conflito (outro consumidor inseriu primeiro): reseleciona.
  const [row] = await tx
    .select({
      id: conversations.id,
      contactId: conversations.contactId,
      aiMode: conversations.aiMode,
      assignedTo: conversations.assignedTo,
      teamId: conversations.teamId,
    })
    .from(conversations)
    .where(and(eq(conversations.channelId, channelId), eq(conversations.remoteId, remoteId)))
    .limit(1);

  if (row === undefined) {
    throw new Error('inbound: conversa não materializou após upsert (estado inconsistente).');
  }
  return {
    contactId: row.contactId ?? contactId,
    conversationId: row.id,
    aiMode: row.aiMode,
    assignedTo: row.assignedTo ?? null,
    teamId: row.teamId ?? null,
  };
}

/**
 * Garante o contato do `remoteId` dentro do workspace. WA/WAHA expõem telefone
 * como remote id → casamos por `uq_contacts_workspace_phone`; quando não, criamos
 * um contato novo (IG igsid não é telefone — F1.5 refina). Retorna o `contactId`.
 */
async function ensureContact(tx: DbTx, workspaceId: string, remoteId: string): Promise<string> {
  const { contacts } = schema;

  const [existing] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.workspaceId, workspaceId),
        eq(contacts.phone, remoteId),
        isNull(contacts.deletedAt),
      ),
    )
    .limit(1);

  if (existing !== undefined) return existing.id;

  const [created] = await tx
    .insert(contacts)
    .values({ workspaceId, phone: remoteId, source: 'whatsapp' })
    .returning({ id: contacts.id });

  if (created === undefined) {
    throw new Error('inbound: contato não materializou após insert.');
  }
  return created.id;
}

/**
 * Insere as mensagens, deduplicando por `uq_messages_external (conversation_id,
 * external_id)` via `onConflictDoNothing`. Retorna só as efetivamente inseridas
 * (as deduplicadas não emitem `message:new`).
 */
async function insertMessages(
  tx: DbTx,
  workspaceId: string,
  conversationId: string,
  events: readonly InboundMessageEvent[],
): Promise<InsertedMessage[]> {
  const { messages } = schema;
  const inserted: InsertedMessage[] = [];

  for (const event of events) {
    const [row] = await tx
      .insert(messages)
      .values({
        workspaceId,
        conversationId,
        externalId: event.externalId,
        direction: 'inbound',
        senderType: 'contact',
        type: event.messageType,
        content: event.content ?? null,
        viewStatus: 'delivered',
        createdAt: toDate(event.rawTimestamp),
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
      })
      .onConflictDoNothing({
        target: [messages.conversationId, messages.externalId],
        // `uq_messages_external` é PARCIAL (WHERE external_id IS NOT NULL). O ON
        // CONFLICT só casa um índice parcial repetindo o predicado — sem isto o
        // Postgres rejeita ("no unique constraint matching") e a mensagem some.
        where: sql`${messages.externalId} is not null`,
      })
      .returning({ id: messages.id });

    if (row !== undefined) {
      inserted.push({
        messageId: row.id,
        externalId: event.externalId,
        type: event.messageType,
        content: event.content ?? null,
      });
    }
  }

  return inserted;
}

/**
 * Atualiza `conversations.last_message_*` + `unread_count` e carimba `updated_at`
 * (bump de cache version). Usa a última mensagem inserida como preview.
 */
async function bumpConversation(
  tx: DbTx,
  conversationId: string,
  events: readonly InboundMessageEvent[],
  insertedCount: number,
): Promise<void> {
  const { conversations } = schema;
  const last = events[events.length - 1];
  if (last === undefined) return;

  await tx
    .update(conversations)
    .set({
      lastMessagePreview: previewOf(last),
      lastMessageAt: toDate(last.rawTimestamp),
      lastMessageFrom: 'contact',
      unreadCount: sql`${conversations.unreadCount} + ${insertedCount}`,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}
