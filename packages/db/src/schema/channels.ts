/** Canais de mensageria (DATA_MODEL §6.1/6.2). provider = identidade técnica. */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const channels = pgTable(
  'channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    name: text('name').notNull(),
    displayHandle: text('display_handle'),

    // WhatsApp Cloud
    phoneNumber: text('phone_number'),
    phoneNumberId: text('phone_number_id'),
    wabaId: text('waba_id'),

    // Instagram Messaging (Meta)
    igUserId: text('ig_user_id'),
    igUsername: text('ig_username'),
    igAccountType: text('ig_account_type'),
    fbPageId: text('fb_page_id'),

    // WAHA
    wahaSessionId: text('waha_session_id'),

    // DEPRECATED: verify token agora é platform-level (platform_secrets).
    webhookVerifyToken: text('webhook_verify_token'),

    isActive: boolean('is_active').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    uniqueIndex('uq_channels_phone_number_id')
      .on(t.phoneNumberId)
      .where(sql`${t.phoneNumberId} is not null`),
    uniqueIndex('uq_channels_ig_user_id')
      .on(t.igUserId)
      .where(sql`${t.igUserId} is not null`),
    index('idx_channels_workspace').on(t.workspaceId),
    index('idx_channels_provider')
      .on(t.workspaceId, t.provider)
      .where(sql`${t.isActive} = true`),
    check('channels_provider_chk', sql`${t.provider} in ('meta_whatsapp','meta_instagram','waha')`),
    check(
      'channels_ig_account_type_chk',
      sql`${t.igAccountType} in ('business','creator') or ${t.igAccountType} is null`,
    ),
    // Coerência: o provider determina quais colunas são obrigatórias.
    check(
      'channels_provider_columns',
      sql`(${t.provider} = 'meta_whatsapp' and ${t.phoneNumberId} is not null and ${t.wabaId} is not null)
       or (${t.provider} = 'meta_instagram' and ${t.igUserId} is not null and ${t.fbPageId} is not null)
       or (${t.provider} = 'waha' and ${t.wahaSessionId} is not null)`,
    ),
  ],
);

export const channelSecrets = pgTable('channel_secrets', {
  channelId: uuid('channel_id')
    .primaryKey()
    .references(() => channels.id, { onDelete: 'cascade' }),
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc'),
  appSecretEnc: text('app_secret_enc'),
  apiKeyEnc: text('api_key_enc'),
  keyVersion: integer('key_version').notNull().default(1),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
