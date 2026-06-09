/** Conversations — thread entre contact e workspace (DATA_MODEL §6.3). */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { channels, contacts, members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    remoteId: text('remote_id').notNull(),
    kind: text('kind').notNull().default('direct'),
    status: text('status').notNull().default('open'),
    aiMode: text('ai_mode').notNull().default('off'),
    assignedTo: uuid('assigned_to').references(() => members.id, { onDelete: 'set null' }),
    // FK adicionada quando departments/teams/agents existirem (F1+/F2).
    departmentId: uuid('department_id'),
    teamId: uuid('team_id'),
    agentId: uuid('agent_id'),
    groupName: text('group_name'),
    groupAvatarUrl: text('group_avatar_url'),
    lastMessageId: uuid('last_message_id'),
    lastMessagePreview: text('last_message_preview'),
    lastMessageAt: ts('last_message_at'),
    lastMessageFrom: text('last_message_from'),
    unreadCount: integer('unread_count').notNull().default(0),
    pinned: boolean('pinned').notNull().default(false),
    snoozedUntil: ts('snoozed_until'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    uniqueIndex('uq_conversations_channel_remote').on(t.channelId, t.remoteId),
    index('idx_conversations_ws_status_lastmsg').on(
      t.workspaceId,
      t.status,
      t.lastMessageAt.desc(),
    ),
    index('idx_conversations_assigned').on(t.assignedTo).where(sql`${t.assignedTo} is not null`),
    index('idx_conversations_contact').on(t.contactId).where(sql`${t.contactId} is not null`),
    check('conversations_kind_chk', sql`${t.kind} in ('direct','group','story_thread','comment_thread')`),
    check('conversations_status_chk', sql`${t.status} in ('open','pending','closed','resolved','snoozed')`),
    check('conversations_ai_mode_chk', sql`${t.aiMode} in ('off','on','paused')`),
    check(
      'conversations_last_from_chk',
      sql`${t.lastMessageFrom} in ('contact','member','agent','system') or ${t.lastMessageFrom} is null`,
    ),
  ],
);
