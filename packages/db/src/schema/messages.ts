/** Messages (DATA_MODEL §6.4). type discriminado (comuns + Instagram). */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { conversations, members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Estado do pipeline de download de mídia inbound (F52-S01 — LIVECHAT.md).
 * Enum PG dedicado (não `text`+check) porque o domínio é fechado e estável e é
 * consumido fora do `@hm/db` (worker de mídia + `@hm/shared`). `pending` = enfileirado,
 * `downloading` = em voo, `ready` = persistido no storage, `failed` = esgotou retries.
 */
export const mediaStatusEnum = pgEnum('media_status', [
  'pending',
  'downloading',
  'ready',
  'failed',
]);

/** União fechada dos estados de mídia — reexportada p/ workers/shared sem importar Drizzle. */
export type MediaStatus = (typeof mediaStatusEnum.enumValues)[number];

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    direction: text('direction').notNull(),
    senderType: text('sender_type').notNull(),
    senderMemberId: uuid('sender_member_id').references(() => members.id, { onDelete: 'set null' }),
    senderAgentId: uuid('sender_agent_id'), // FK quando agents existir (F2)
    type: text('type').notNull().default('text'),
    content: text('content'),
    viewStatus: text('view_status').notNull().default('pending'),
    failedReason: text('failed_reason'),
    mediaUrl: text('media_url'),
    mediaMime: text('media_mime'),
    mediaSizeBytes: bigint('media_size_bytes', { mode: 'number' }),
    mediaSha256: text('media_sha256'),
    mediaCaption: text('media_caption'),
    interactivePayload: jsonb('interactive_payload').$type<Record<string, unknown>>(),
    replyToMessageId: uuid('reply_to_message_id').references((): AnyPgColumn => messages.id, {
      onDelete: 'set null',
    }),
    reactionEmoji: text('reaction_emoji'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    // F52-S01 (sync foundation): estado do download de mídia inbound. NULL = sem
    // mídia / não aplicável; preenchido pelo worker de mídia em slot posterior.
    mediaStatus: mediaStatusEnum('media_status'),
    // Horário autoritativo do provedor (Meta/WAHA). Usado para ordenação fiel da
    // timeline quando difere do created_at local (clock skew / reprocessamento).
    providerTimestamp: ts('provider_timestamp'),
    // Chave de idempotência de ENVIO (outbound): dedup de mensagens enviadas em
    // retries/reentrega. NULL p/ inbound. Unicidade via índice parcial abaixo.
    outboundIdempotencyKey: text('outbound_idempotency_key'),
    deliveredAt: ts('delivered_at'),
    readAt: ts('read_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    uniqueIndex('uq_messages_external')
      .on(t.conversationId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    // F52-S01: idempotência de envio. Único parcial só quando a chave existe
    // (espelha o estilo de uq_messages_external) → inbound (NULL) nunca colide.
    uniqueIndex('uq_messages_outbound_idempotency_key')
      .on(t.outboundIdempotencyKey)
      .where(sql`${t.outboundIdempotencyKey} is not null`),
    index('idx_messages_conversation_created').on(t.conversationId, t.createdAt.desc()),
    // F52-S01: ordenação fiel da timeline pelo horário do provedor, com fallback
    // p/ created_at quando ausente. DESC p/ servir "últimas mensagens" sem sort.
    index('idx_messages_conversation_provider_ts').on(
      t.conversationId,
      sql`coalesce(${t.providerTimestamp}, ${t.createdAt}) desc`,
    ),
    index('idx_messages_workspace_created').on(t.workspaceId, t.createdAt.desc()),
    check('messages_direction_chk', sql`${t.direction} in ('inbound','outbound')`),
    check('messages_sender_type_chk', sql`${t.senderType} in ('contact','member','agent','system')`),
    check('messages_view_status_chk', sql`${t.viewStatus} in ('pending','sending','sent','delivered','read','failed','deleted')`),
    check(
      'messages_type_chk',
      sql`${t.type} in ('text','image','video','audio','voice','document','sticker','location','contact','interactive','template','reaction','system','story_mention','story_reply','share','comment','comment_reply','ig_postback','referral')`,
    ),
  ],
);
