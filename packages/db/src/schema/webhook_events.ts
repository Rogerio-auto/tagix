/**
 * Dedup de webhooks inbound na borda da API (LIVECHAT.md §1/§2.4, F1-S02).
 *
 * A verificação de duplicidade acontece ANTES da resolução de workspace/channel
 * (que é responsabilidade do worker-inbound). Por isso a tabela é platform-level
 * (sem `workspace_id` → fora do RLS de tenant) e a chave de dedup é
 * `(provider, external_event_id)` — o id único que o provider atribui ao evento
 * (wamid no WhatsApp, mid no Instagram, message id no WAHA).
 *
 * `raw_payload` é mantido por 30 dias (retenção) para hotfix de parser
 * (LIVECHAT.md §risco "Meta muda webhook payload").
 */
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    /** Id único do evento atribuído pelo provider (wamid / mid / waha id). */
    externalEventId: text('external_event_id').notNull(),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_webhook_events_provider_event').on(t.provider, t.externalEventId),
    // Retenção 30d (limpeza por job): índice por received_at desc para o sweep.
    index('idx_webhook_events_received').on(t.receivedAt.desc()),
  ],
);
