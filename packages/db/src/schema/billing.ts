/**
 * Billing provider-agnóstico (F41 — PAYMENTS_ABACATEPAY.md §2).
 *
 * As tabelas `plans`/`subscriptions` (definidas em `./index`) já existem desde a
 * F26 com colunas `stripe_*` de scaffold — tratadas como LEGADO (não removidas
 * neste slot). A F41 adiciona campos genéricos do gateway real (AbacatePay) via
 * migration `0046` — ver lá os `ALTER TABLE`. Aqui mora a tabela NOVA do domínio:
 *
 * - `payment_events` — ledger + idempotência de DOMÍNIO. Cada evento de pagamento
 *   processado a partir do webhook é gravado uma única vez (UNIQUE provider+event).
 *   A dedup de BORDA (HTTP) continua em `webhook_events` (`provider='abacatepay'`);
 *   esta tabela registra a transição de domínio (assinatura/cobrança) + audit trail.
 *
 *   `workspace_id` é NULLABLE: nem todo evento resolve um workspace na chegada
 *   (ex.: evento de produto/catálogo, ou antes do mapeamento). Mesma postura de
 *   `audit_logs` → RLS isola por workspace quando presente; eventos sem workspace
 *   ficam visíveis só para o owner/bypass (leitura platform). FK para `workspaces`
 *   com `ON DELETE SET NULL` (preserva o histórico de pagamentos ao remover o tenant).
 */
import { bigint, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './index';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const paymentEvents = pgTable(
  'payment_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Gateway de origem (ex.: 'abacatepay'). */
    provider: text('provider').notNull(),
    /** Id único do evento atribuído pelo provider (chave de idempotência de domínio). */
    externalEventId: text('external_event_id').notNull(),
    /** Tipo do evento do provider (ex.: 'checkout.completed', 'subscription.renewed'). */
    eventType: text('event_type').notNull(),
    /** Workspace afetado (nullable até o mapeamento resolver; set null ao remover o tenant). */
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    /** Id da assinatura no provider (correlaciona com subscriptions.external_subscription_id). */
    subscriptionExternalId: text('subscription_external_id'),
    /** Valor em centavos (BRL), quando o evento carrega montante. */
    amountCents: bigint('amount_cents', { mode: 'number' }),
    /** Status de domínio derivado do evento (ex.: 'active', 'past_due', 'canceled'). */
    status: text('status'),
    /** Payload bruto do provider (auditoria + reprocessamento de parser). */
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    /** Carimbo de quando a transição de domínio foi aplicada (null = ainda não processado). */
    processedAt: ts('processed_at'),
  },
  (t) => [
    // Idempotência de domínio: um evento do provider entra uma única vez.
    uniqueIndex('uq_payment_events_provider_event').on(t.provider, t.externalEventId),
    // Listagem por tenant (histórico de cobranças no billing portal).
    index('idx_payment_events_workspace').on(t.workspaceId),
    // Varredura/auditoria temporal (mais recentes primeiro).
    index('idx_payment_events_received').on(t.receivedAt.desc()),
  ],
);

export type PaymentEvent = typeof paymentEvents.$inferSelect;
export type NewPaymentEvent = typeof paymentEvents.$inferInsert;
