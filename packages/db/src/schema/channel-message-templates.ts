/**
 * Catálogo local de modelos de mensagem do WhatsApp oficial (F58-S02).
 *
 * Os valores de `status` e `category` são preservados como texto porque a Meta pode
 * adicionar estados sem aviso. A camada de produto traduz os valores conhecidos e
 * continua conseguindo armazenar os desconhecidos. `components`, da mesma forma,
 * cruza a fronteira externa como `unknown[]`; consumidores precisam validá-lo antes
 * de interpretar a estrutura.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { channels } from './channels';
import { workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const channelMessageTemplates = pgTable(
  'channel_message_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id').notNull(),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    language: text('language').notNull(),
    category: text('category').notNull(),
    status: text('status').notNull(),
    components: jsonb('components').$type<unknown[]>().notNull().default([]),
    rejectionReason: text('rejection_reason'),
    isAvailable: boolean('is_available').notNull().default(true),
    lastSyncedAt: ts('last_synced_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    foreignKey({
      name: 'channel_message_templates_workspace_channel_fk',
      columns: [t.workspaceId, t.channelId],
      foreignColumns: [channels.workspaceId, channels.id],
    }).onDelete('cascade'),
    uniqueIndex('uq_channel_message_templates_channel_name_language').on(
      t.channelId,
      t.name,
      t.language,
    ),
    uniqueIndex('uq_channel_message_templates_channel_external').on(
      t.channelId,
      t.externalId,
    ),
    index('idx_channel_message_templates_workspace_channel').on(t.workspaceId, t.channelId),
    index('idx_channel_message_templates_channel_status').on(
      t.workspaceId,
      t.channelId,
      t.status,
    ),
    index('idx_channel_message_templates_channel_category').on(
      t.workspaceId,
      t.channelId,
      t.category,
    ),
    check(
      'channel_message_templates_components_array_chk',
      sql`jsonb_typeof(${t.components}) = 'array'`,
    ),
  ],
);

/**
 * Cursor operacional da sincronização, um por canal.
 *
 * `lastSuccessfulSyncAt` é deliberadamente independente da tentativa atual: um
 * catálogo vazio ainda é um sucesso válido e uma falha posterior só atualiza os
 * campos de tentativa/erro, sem apagar quando houve o último sucesso.
 */
export const channelMessageTemplateSyncStates = pgTable(
  'channel_message_template_sync_states',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id').primaryKey(),
    syncStatus: text('sync_status').notNull().default('idle'),
    lastAttemptAt: ts('last_attempt_at'),
    lastSuccessfulSyncAt: ts('last_successful_sync_at'),
    lastFailedAt: ts('last_failed_at'),
    lastError: text('last_error'),
    lastItemCount: integer('last_item_count'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    foreignKey({
      name: 'channel_message_template_sync_states_workspace_channel_fk',
      columns: [t.workspaceId, t.channelId],
      foreignColumns: [channels.workspaceId, channels.id],
    }).onDelete('cascade'),
    index('idx_channel_message_template_sync_states_workspace').on(t.workspaceId),
    check(
      'channel_message_template_sync_states_item_count_chk',
      sql`${t.lastItemCount} is null or ${t.lastItemCount} >= 0`,
    ),
  ],
);

export type ChannelMessageTemplate = typeof channelMessageTemplates.$inferSelect;
export type NewChannelMessageTemplate = typeof channelMessageTemplates.$inferInsert;
export type ChannelMessageTemplateSyncState =
  typeof channelMessageTemplateSyncStates.$inferSelect;
export type NewChannelMessageTemplateSyncState =
  typeof channelMessageTemplateSyncStates.$inferInsert;
