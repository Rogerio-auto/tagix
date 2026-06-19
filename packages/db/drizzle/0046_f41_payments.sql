-- F41-S02: Billing provider-agnóstico (PAYMENTS_ABACATEPAY.md §2).
--
-- 1) Colunas genéricas de gateway em plans/subscriptions (colunas stripe_* ficam
--    como LEGADO, não removidas aqui). 2) Tabela payment_events (ledger +
--    idempotência de domínio). 3) RLS de payment_events (workspace-scoped quando
--    workspace_id presente; eventos sem workspace só p/ owner/bypass — espelha audit_logs).

-- ── plans: id do product no gateway real (sync via externalId = plan.id) ──
ALTER TABLE "plans" ADD COLUMN "payment_provider_product_id" text;
--> statement-breakpoint

-- ── subscriptions: gateway real (reusa current_period_*, cancel_at_period_end, canceled_at) ──
ALTER TABLE "subscriptions" ADD COLUMN "payment_provider" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "external_customer_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "external_subscription_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "external_product_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_payment_method_chk"
  CHECK ("payment_method" is null or "payment_method" in ('card','pix'));
--> statement-breakpoint

-- ── payment_events: ledger + idempotência de DOMÍNIO ──
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"workspace_id" uuid,
	"subscription_external_id" text,
	"amount_cents" bigint,
	"status" text,
	"raw_payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_events_provider_event" ON "payment_events" USING btree ("provider","external_event_id");--> statement-breakpoint
CREATE INDEX "idx_payment_events_workspace" ON "payment_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_payment_events_received" ON "payment_events" USING btree ("received_at" DESC);
--> statement-breakpoint

-- ── RLS: payment_events workspace-scoped (workspace_id NULLABLE → eventos sem
--    workspace ficam invisíveis ao hm_app; leitura platform via owner/bypass). ──
GRANT SELECT, INSERT, UPDATE, DELETE ON payment_events TO hm_app;--> statement-breakpoint
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payment_events_isolation ON payment_events
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
