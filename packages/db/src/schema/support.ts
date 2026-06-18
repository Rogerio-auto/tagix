/**
 * Chat ao Vivo com o Suporte (F38 — SUPPORT.md §2). Canal INTERNO entre o membro
 * do workspace e a equipe Leadium (platform admins). Não usa Meta/WhatsApp; usa
 * o Socket.io já configurado.
 *
 * - `support_threads` — WORKSPACE-SCOPED (RLS de tenant): o membro vê só os do
 *   seu workspace; o platform-admin faz bypass (lê/escreve tudo, mesma postura do
 *   inbox cross-workspace dos painéis platform). `assigned_to` é um member id da
 *   plataforma (referência fraca: set null no delete).
 * - `support_messages` — sem `workspace_id` próprio: isolada via subquery em
 *   `support_threads` (espelha flow_versions/campaign_steps/event_participants).
 *   `sender_type` distingue member|platform; `attachments` é jsonb de signed URLs.
 *
 * RLS: thread por `workspace_id`; messages via subquery na thread. Migration
 * custom dedicada (`00YY_f38_help_support_rls.sql`).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Anexo de mensagem de suporte (signed URL via storage existente). */
export type SupportAttachment = {
  key: string;
  name: string;
  contentType: string;
  size: number;
};

export const supportThreads = pgTable(
  'support_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    openedBy: uuid('opened_by').references(() => members.id, { onDelete: 'set null' }),
    subject: text('subject').notNull(),
    status: text('status').notNull().default('open'),
    priority: text('priority').notNull().default('normal'),
    /** Member da plataforma responsável (referência fraca: outro workspace). */
    assignedTo: uuid('assigned_to'),
    lastMessageAt: ts('last_message_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_support_threads_workspace_last_message').on(
      t.workspaceId,
      t.lastMessageAt.desc(),
    ),
    index('idx_support_threads_status_last_message').on(t.status, t.lastMessageAt.desc()),
    check('support_threads_status_chk', sql`${t.status} in ('open','pending','resolved')`),
    check('support_threads_priority_chk', sql`${t.priority} in ('low','normal','high')`),
    check('support_threads_subject_not_empty_chk', sql`length(btrim(${t.subject})) > 0`),
  ],
);

export const supportMessages = pgTable(
  'support_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => supportThreads.id, { onDelete: 'cascade' }),
    senderType: text('sender_type').notNull(),
    /** member id (member ou platform admin). Referência fraca → set null no delete. */
    senderId: uuid('sender_id'),
    body: text('body').notNull(),
    attachments: jsonb('attachments')
      .$type<SupportAttachment[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_support_messages_thread_created').on(t.threadId, t.createdAt),
    check('support_messages_sender_type_chk', sql`${t.senderType} in ('member','platform')`),
    check('support_messages_body_not_empty_chk', sql`length(btrim(${t.body})) > 0`),
  ],
);
