CREATE TABLE "impersonation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_member_id" uuid NOT NULL,
	"target_workspace_id" uuid NOT NULL,
	"mode" text DEFAULT 'view' NOT NULL,
	"reason" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ip_address" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "impersonation_sessions_mode_chk" CHECK ("impersonation_sessions"."mode" in ('view'))
);
--> statement-breakpoint
CREATE TABLE "workspace_entitlement_overrides" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_usage_logs" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_admin_member_id_members_id_fk" FOREIGN KEY ("admin_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_target_workspace_id_workspaces_id_fk" FOREIGN KEY ("target_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_entitlement_overrides" ADD CONSTRAINT "workspace_entitlement_overrides_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_entitlement_overrides" ADD CONSTRAINT "workspace_entitlement_overrides_updated_by_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_impersonation_active" ON "impersonation_sessions" USING btree ("admin_member_id","expires_at") WHERE "impersonation_sessions"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "idx_impersonation_target" ON "impersonation_sessions" USING btree ("target_workspace_id");--> statement-breakpoint
CREATE INDEX "idx_llm_usage_is_test_created" ON "llm_usage_logs" USING btree ("created_at" DESC NULLS LAST) WHERE "llm_usage_logs"."is_test" = true;--> statement-breakpoint

-- ─── RLS de workspace_entitlement_overrides (F26-S01) ─────────────────────────
-- 1:1 com workspace (PK=workspace_id) → isolamento direto. hm_app sofre RLS; o owner
-- (migrate/seed e a camada de plataforma, gated por requirePlatformAdmin) bypassa.
-- impersonation_sessions é PLATFORM-LEVEL (target_workspace_id é alvo, não dono) →
-- NÃO recebe RLS de tenant; o guard + audit são a fronteira (espelha platform_secrets).
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_entitlement_overrides TO hm_app;--> statement-breakpoint
ALTER TABLE workspace_entitlement_overrides ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY workspace_entitlement_overrides_isolation ON workspace_entitlement_overrides
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
