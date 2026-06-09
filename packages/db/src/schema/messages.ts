/** Messages (DATA_MODEL §6.4). type discriminado (comuns + Instagram). */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { conversations, members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

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
    index('idx_messages_conversation_created').on(t.conversationId, t.createdAt.desc()),
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
