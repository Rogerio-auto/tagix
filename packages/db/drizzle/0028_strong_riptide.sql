CREATE TABLE "campaign_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"message_id" uuid,
	"external_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	CONSTRAINT "campaign_deliveries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "campaign_deliveries_status_chk" CHECK ("campaign_deliveries"."status" in ('queued','sent','delivered','read','failed','blocked'))
);
--> statement-breakpoint
CREATE TABLE "campaign_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"trigger_event" text NOT NULL,
	"delay_minutes" integer DEFAULT 60 NOT NULL,
	"template_name" text NOT NULL,
	"language_code" text DEFAULT 'pt_BR' NOT NULL,
	"template_components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "campaign_followups_position_uq" UNIQUE("campaign_id","position"),
	CONSTRAINT "campaign_followups_trigger_chk" CHECK ("campaign_followups"."trigger_event" in ('on_reply','on_no_reply','on_delivered'))
);
--> statement-breakpoint
CREATE TABLE "campaign_metrics" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"total_recipients" integer DEFAULT 0 NOT NULL,
	"messages_queued" integer DEFAULT 0 NOT NULL,
	"messages_sent" integer DEFAULT 0 NOT NULL,
	"messages_delivered" integer DEFAULT 0 NOT NULL,
	"messages_read" integer DEFAULT 0 NOT NULL,
	"messages_replied" integer DEFAULT 0 NOT NULL,
	"messages_failed" integer DEFAULT 0 NOT NULL,
	"messages_blocked" integer DEFAULT 0 NOT NULL,
	"delivery_rate" numeric(5, 2),
	"read_rate" numeric(5, 2),
	"response_rate" numeric(5, 2),
	"block_rate" numeric(5, 2),
	"health_status" text DEFAULT 'healthy' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_metrics_health_chk" CHECK ("campaign_metrics"."health_status" in ('healthy','warning','critical'))
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_step_index" integer DEFAULT -1,
	"last_step_at" timestamp with time zone,
	"responded" boolean DEFAULT false NOT NULL,
	"responded_at" timestamp with time zone,
	"failed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_recipients_campaign_contact_uq" UNIQUE("campaign_id","contact_id"),
	CONSTRAINT "campaign_recipients_status_chk" CHECK ("campaign_recipients"."status" in ('pending','sending','completed','responded','failed','opted_out'))
);
--> statement-breakpoint
CREATE TABLE "campaign_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"template_name" text NOT NULL,
	"language_code" text DEFAULT 'pt_BR' NOT NULL,
	"template_components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delay_seconds" integer DEFAULT 0 NOT NULL,
	"stop_on_reply" boolean DEFAULT true NOT NULL,
	CONSTRAINT "campaign_steps_position_uq" UNIQUE("campaign_id","position")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"send_windows" jsonb DEFAULT '{"enabled":false}'::jsonb NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 30 NOT NULL,
	"daily_limit" integer DEFAULT 1000,
	"messages_sent_today" integer DEFAULT 0 NOT NULL,
	"last_daily_reset_at" timestamp with time zone,
	"next_tick_at" timestamp with time zone,
	"auto_handoff_on_reply" boolean DEFAULT true NOT NULL,
	"ai_handoff_agent_id" uuid,
	"segment_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "campaigns_type_chk" CHECK ("campaigns"."type" in ('broadcast','drip','triggered')),
	CONSTRAINT "campaigns_status_chk" CHECK ("campaigns"."status" in ('draft','scheduled','running','paused','completed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "scheduled_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"followup_id" uuid NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"failed_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_followups_recipient_followup_uq" UNIQUE("recipient_id","followup_id"),
	CONSTRAINT "scheduled_followups_status_chk" CHECK ("scheduled_followups"."status" in ('scheduled','processing','sent','failed','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "campaign_deliveries" ADD CONSTRAINT "campaign_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_deliveries" ADD CONSTRAINT "campaign_deliveries_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_deliveries" ADD CONSTRAINT "campaign_deliveries_recipient_id_campaign_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."campaign_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_deliveries" ADD CONSTRAINT "campaign_deliveries_step_id_campaign_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."campaign_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_deliveries" ADD CONSTRAINT "campaign_deliveries_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_followups" ADD CONSTRAINT "campaign_followups_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_metrics" ADD CONSTRAINT "campaign_metrics_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_metrics" ADD CONSTRAINT "campaign_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_ai_handoff_agent_id_agents_id_fk" FOREIGN KEY ("ai_handoff_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_followups" ADD CONSTRAINT "scheduled_followups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_followups" ADD CONSTRAINT "scheduled_followups_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_followups" ADD CONSTRAINT "scheduled_followups_recipient_id_campaign_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."campaign_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_followups" ADD CONSTRAINT "scheduled_followups_followup_id_campaign_followups_id_fk" FOREIGN KEY ("followup_id") REFERENCES "public"."campaign_followups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_campaign_deliveries_campaign_status" ON "campaign_deliveries" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "idx_campaign_recipients_status" ON "campaign_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "idx_campaigns_workspace_status" ON "campaigns" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "idx_scheduled_followups_due" ON "scheduled_followups" USING btree ("status","scheduled_at");