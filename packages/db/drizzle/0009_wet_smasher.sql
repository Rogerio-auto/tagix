CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_webhook_events_provider_event" ON "webhook_events" USING btree ("provider","external_event_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_events_received" ON "webhook_events" USING btree ("received_at" DESC NULLS LAST);