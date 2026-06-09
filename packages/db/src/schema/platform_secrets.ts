/**
 * Segredos de plataforma (LIVECHAT.md §2.4) — meta_app_secret, meta_app_id,
 * meta_webhook_verify_token, etc. Cifrados (AES-256-GCM). SEM workspace_id
 * (platform-level) → sem RLS de tenant; só o boot da API lê (conexão owner).
 */
import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const platformSecrets = pgTable('platform_secrets', {
  key: text('key').primaryKey(),
  valueEnc: text('value_enc').notNull(),
  keyVersion: integer('key_version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
