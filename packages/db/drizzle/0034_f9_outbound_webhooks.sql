CREATE TABLE "outbound_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"response_status" integer,
	"response_body" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "outbound_webhook_deliveries_status_chk" CHECK ("outbound_webhook_deliveries"."status" in ('pending','sent','failed','retrying'))
);
--> statement-breakpoint
CREATE TABLE "outbound_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret_enc" text NOT NULL,
	"events" text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "idx_api_keys_workspace";--> statement-breakpoint
ALTER TABLE "outbound_webhook_deliveries" ADD CONSTRAINT "outbound_webhook_deliveries_webhook_id_outbound_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."outbound_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_webhook_deliveries" ADD CONSTRAINT "outbound_webhook_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_webhooks" ADD CONSTRAINT "outbound_webhooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_outbound_webhook_deliveries_pending" ON "outbound_webhook_deliveries" USING btree ("next_attempt_at") WHERE "outbound_webhook_deliveries"."status" in ('pending','retrying');--> statement-breakpoint
CREATE INDEX "idx_outbound_webhooks_workspace" ON "outbound_webhooks" USING btree ("workspace_id") WHERE "outbound_webhooks"."is_active" = true;--> statement-breakpoint
CREATE INDEX "idx_api_keys_workspace" ON "api_keys" USING btree ("workspace_id") WHERE "api_keys"."is_active" = true;--> statement-breakpoint

-- ─── RLS das tabelas de webhooks outbound (F9-S01) ────────────────────────────
-- Ambas têm workspace_id próprio → isolamento direto. hm_app sofre RLS; o owner
-- (migrate/seed) e o worker-webhooks (que roda com app.workspace_id setado por
-- delivery) operam dentro do tenant. Mesmo padrão das tabelas da F8.
GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_webhooks TO hm_app;--> statement-breakpoint
ALTER TABLE outbound_webhooks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY outbound_webhooks_isolation ON outbound_webhooks
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_webhook_deliveries TO hm_app;--> statement-breakpoint
ALTER TABLE outbound_webhook_deliveries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY outbound_webhook_deliveries_isolation ON outbound_webhook_deliveries
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);