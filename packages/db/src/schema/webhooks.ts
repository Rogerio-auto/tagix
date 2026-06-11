/**
 * Outbound webhooks (F9 §14.3): assinaturas de cliente para receber eventos de
 * domínio do workspace (message.received/sent, deal.*, conversion.*, ...) em uma
 * URL externa, assinadas via HMAC.
 *
 * - `outbound_webhooks` — a assinatura. `secret_enc` guarda o segredo HMAC cifrado
 *   em AES-256-GCM (reusa o helper de cripto da F1-S01); o worker-webhooks (F9-S05)
 *   decifra na hora de assinar o payload. Nunca é exposto em leitura pela API.
 * - `outbound_webhook_deliveries` — fila durável de entrega com retry. Cada evento
 *   que casa uma assinatura ativa vira uma linha `pending`; o worker faz o POST,
 *   atualiza status/response e reagenda (`next_attempt_at`) em backoff exponencial
 *   até `sent` ou esgotar as tentativas (`failed`). O índice parcial de pendentes
 *   é o hot-path do dispatcher.
 *
 * RLS: ambas têm `workspace_id` próprio → isolamento direto (migration custom).
 */
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
  uuid,
} from 'drizzle-orm/pg-core';
import { workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const outboundWebhooks = pgTable(
  'outbound_webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    // Segredo HMAC cifrado em AES-256-GCM. Nunca retornado em leitura pela API.
    secretEnc: text('secret_enc').notNull(),
    // Eventos de domínio assinados — ex.: ['message.received','deal.stage_changed'].
    events: text('events').array().notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at'),
  },
  (t) => [
    // Dispatcher resolve assinaturas ativas por workspace ao fan-out de um evento.
    index('idx_outbound_webhooks_workspace').on(t.workspaceId).where(sql`${t.isActive} = true`),
  ],
);

export const outboundWebhookDeliveries = pgTable(
  'outbound_webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => outboundWebhooks.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('pending'),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    attempt: integer('attempt').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    sentAt: ts('sent_at'),
  },
  (t) => [
    // Hot-path do dispatcher: varre pendentes/retrying com next_attempt_at vencido.
    index('idx_outbound_webhook_deliveries_pending')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} in ('pending','retrying')`),
    check(
      'outbound_webhook_deliveries_status_chk',
      sql`${t.status} in ('pending','sent','failed','retrying')`,
    ),
  ],
);
