/**
 * Conversation notes (F1-S22 / LIVECHAT.md §7.4) — notas internas por conversa,
 * visíveis só para a equipe (nunca enviadas ao contato). Cada nota pode mencionar
 * membros via `@member`; os ids mencionados ficam materializados em `mentions[]`
 * (uuid[]) para gerar notificação ao mencionado (socket `member:{id}`).
 *
 * Tabela tenant-scoped (`workspace_id`) → RLS obrigatória no mesmo slot
 * (migration custom, ver `drizzle/00XX_conversation_notes_rls.sql`).
 */
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { conversations, members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const conversationNotes = pgTable(
  'conversation_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    authorMemberId: uuid('author_member_id').references(() => members.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    /** Membros mencionados (`@member`) — materializado para notificação/filtragem. */
    mentions: uuid('mentions').array().notNull().default(sql`'{}'`),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    index('idx_conversation_notes_conversation_created').on(
      t.conversationId,
      t.createdAt.desc(),
    ),
    index('idx_conversation_notes_workspace_created').on(t.workspaceId, t.createdAt.desc()),
    check('conversation_notes_body_not_empty_chk', sql`length(btrim(${t.body})) > 0`),
  ],
);
