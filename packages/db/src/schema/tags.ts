/**
 * Tags + contact_tags (DATA_MODEL §5.2).
 *
 * Especificadas em §5.2 mas nunca implementadas (F1-S05 não as criou). Destravam:
 * `conversion_tag_triggers` (F5-S03), os handlers add_tag/remove_tag e o trigger
 * tag_added da F4 (F5-S16).
 *
 * RLS: §5.2 não dá `workspace_id` a `contact_tags`; aqui denormalizamos uma coluna
 * `workspace_id` (NOT NULL, FK) para isolamento RLS direto por `app.workspace_id`,
 * coerente com o padrão do projeto (subquery em contacts seria mais lenta no
 * hot-path de tagging). A escrita deve casar `contact_tags.workspace_id` com
 * `contacts.workspace_id`.
 */
import { index, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { contacts, members, workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#1FFF13'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('tags_workspace_name_uq').on(t.workspaceId, t.name),
    index('idx_tags_workspace').on(t.workspaceId),
  ],
);

export const contactTags = pgTable(
  'contact_tags',
  {
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    // Denormalizado p/ RLS direta (ver doc do módulo). Casar com contacts.workspace_id.
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    taggedBy: uuid('tagged_by').references(() => members.id, { onDelete: 'set null' }),
    taggedAt: ts('tagged_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.tagId] }),
    index('idx_contact_tags_tag').on(t.tagId),
    index('idx_contact_tags_workspace').on(t.workspaceId),
  ],
);
