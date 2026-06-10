CREATE TABLE "flow_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"flow_version_id" uuid NOT NULL,
	"conversation_id" uuid,
	"contact_id" uuid,
	"triggered_by" text NOT NULL,
	"triggered_by_member_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"current_node_id" text,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_step_at" timestamp with time zone,
	"last_error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "flow_executions_triggered_by_chk" CHECK ("flow_executions"."triggered_by" in ('manual','automatic','api')),
	CONSTRAINT "flow_executions_status_chk" CHECK ("flow_executions"."status" in ('running','waiting','completed','failed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "flow_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"node_type" text NOT NULL,
	"level" text NOT NULL,
	"message" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flow_logs_level_chk" CHECK ("flow_logs"."level" in ('debug','info','warn','error'))
);
--> statement-breakpoint
CREATE TABLE "flow_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"conversation_id" uuid,
	"meta_flow_id" text NOT NULL,
	"external_id" text,
	"response" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"nodes" jsonb NOT NULL,
	"edges" jsonb NOT NULL,
	"trigger_config" jsonb NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flow_versions_flow_version_uq" UNIQUE("flow_id","version")
);
--> statement-breakpoint
CREATE TABLE "flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"filter_status" text[],
	"filter_stage_ids" uuid[],
	"filter_tag_ids" uuid[],
	"channel_ids" uuid[],
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"manual_position" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "flows_status_chk" CHECK ("flows"."status" in ('draft','active','paused','archived')),
	CONSTRAINT "flows_trigger_type_chk" CHECK ("flows"."trigger_type" in ('manual','stage_change','tag_added','keyword','new_lead','new_message','system_event','flow_submission'))
);
--> statement-breakpoint
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_flow_version_id_flow_versions_id_fk" FOREIGN KEY ("flow_version_id") REFERENCES "public"."flow_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_triggered_by_member_id_members_id_fk" FOREIGN KEY ("triggered_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_logs" ADD CONSTRAINT "flow_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_logs" ADD CONSTRAINT "flow_logs_execution_id_flow_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."flow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_submissions" ADD CONSTRAINT "flow_submissions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_submissions" ADD CONSTRAINT "flow_submissions_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_submissions" ADD CONSTRAINT "flow_submissions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_versions" ADD CONSTRAINT "flow_versions_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_versions" ADD CONSTRAINT "flow_versions_published_by_members_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_flow_executions_status_next" ON "flow_executions" USING btree ("status","next_step_at") WHERE "flow_executions"."status" = 'waiting' and "flow_executions"."next_step_at" is not null;--> statement-breakpoint
CREATE INDEX "idx_flow_executions_workspace_status" ON "flow_executions" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "idx_flow_executions_conversation" ON "flow_executions" USING btree ("conversation_id") WHERE "flow_executions"."conversation_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_flow_logs_execution_created" ON "flow_logs" USING btree ("execution_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_flow_submissions_workspace_created" ON "flow_submissions" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_flows_workspace_status" ON "flows" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "idx_flows_trigger_type" ON "flows" USING btree ("workspace_id","trigger_type") WHERE "flows"."status" = 'active';