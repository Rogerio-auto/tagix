CREATE TABLE "inbox_visibility_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"default_peer_visibility" text DEFAULT 'shared' NOT NULL,
	"readonly_sees_all" boolean DEFAULT true NOT NULL,
	"role_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "inbox_visibility_settings_workspace_id_unique" UNIQUE("workspace_id"),
	CONSTRAINT "inbox_visibility_settings_peer_chk" CHECK ("inbox_visibility_settings"."default_peer_visibility" in ('shared','private'))
);
--> statement-breakpoint
CREATE TABLE "member_visibility_overrides" (
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_visibility_overrides_workspace_id_member_id_department_id_pk" PRIMARY KEY("workspace_id","member_id","department_id"),
	CONSTRAINT "member_visibility_overrides_uq" UNIQUE("member_id","department_id")
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "peer_visibility" text DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ai_paused_reason" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ai_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ai_paused_by" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ai_last_human_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ai_resume_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbox_visibility_settings" ADD CONSTRAINT "inbox_visibility_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_visibility_overrides" ADD CONSTRAINT "member_visibility_overrides_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_visibility_overrides" ADD CONSTRAINT "member_visibility_overrides_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_visibility_overrides" ADD CONSTRAINT "member_visibility_overrides_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_ai_paused_by_members_id_fk" FOREIGN KEY ("ai_paused_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_ai_paused_reason_chk" CHECK ("conversations"."ai_paused_reason" in ('human_takeover','manual') or "conversations"."ai_paused_reason" is null);--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_peer_visibility_chk" CHECK ("teams"."peer_visibility" in ('shared','private','inherit'));--> statement-breakpoint
CREATE INDEX "idx_inbox_visibility_settings_workspace" ON "inbox_visibility_settings" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_member_visibility_overrides_member" ON "member_visibility_overrides" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_member_visibility_overrides_department" ON "member_visibility_overrides" USING btree ("department_id");--> statement-breakpoint
-- idx_conversations_team / idx_conversations_department já existem (criados em 0033).
CREATE INDEX "idx_conversations_ai_resume" ON "conversations" USING btree ("ai_resume_at") WHERE "conversations"."ai_resume_at" is not null;
