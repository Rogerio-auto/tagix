CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "departments_workspace_name_uq" UNIQUE("workspace_id","name"),
	CONSTRAINT "departments_is_active_chk" CHECK ("departments"."is_active" in ('active','archived'))
);
--> statement-breakpoint
CREATE TABLE "sla_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope_type" text DEFAULT 'workspace' NOT NULL,
	"scope_id" uuid,
	"first_response_secs" integer,
	"resolution_secs" integer,
	"is_active" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "sla_rules_workspace_scope_uq" UNIQUE("workspace_id","scope_type","scope_id"),
	CONSTRAINT "sla_rules_scope_type_chk" CHECK ("sla_rules"."scope_type" in ('workspace','department','team')),
	CONSTRAINT "sla_rules_is_active_chk" CHECK ("sla_rules"."is_active" in ('active','archived')),
	CONSTRAINT "sla_rules_scope_id_chk" CHECK (("sla_rules"."scope_type" = 'workspace' and "sla_rules"."scope_id" is null) or ("sla_rules"."scope_type" <> 'workspace' and "sla_rules"."scope_id" is not null)),
	CONSTRAINT "sla_rules_limits_chk" CHECK (("sla_rules"."first_response_secs" is null or "sla_rules"."first_response_secs" > 0) and ("sla_rules"."resolution_secs" is null or "sla_rules"."resolution_secs" > 0))
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_member_id_pk" PRIMARY KEY("team_id","member_id"),
	CONSTRAINT "team_members_role_chk" CHECK ("team_members"."role" in ('lead','member'))
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"department_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"auto_assign_strategy" text DEFAULT 'manual' NOT NULL,
	"is_active" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "teams_workspace_name_uq" UNIQUE("workspace_id","name"),
	CONSTRAINT "teams_is_active_chk" CHECK ("teams"."is_active" in ('active','archived')),
	CONSTRAINT "teams_auto_assign_chk" CHECK ("teams"."auto_assign_strategy" in ('round_robin','least_busy','manual'))
);
--> statement-breakpoint
CREATE TABLE "dashboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_snapshots_ws_metric_scope_uq" UNIQUE("workspace_id","metric_key","scope")
);
--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_rules" ADD CONSTRAINT "sla_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_snapshots" ADD CONSTRAINT "dashboard_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_departments_workspace" ON "departments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_sla_rules_workspace" ON "sla_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_team_members_member" ON "team_members" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_team_members_workspace" ON "team_members" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_teams_workspace" ON "teams" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_teams_department" ON "teams" USING btree ("department_id") WHERE "teams"."department_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_dashboard_snapshots_ws_metric" ON "dashboard_snapshots" USING btree ("workspace_id","metric_key");--> statement-breakpoint
CREATE INDEX "idx_dashboard_snapshots_computed" ON "dashboard_snapshots" USING btree ("computed_at");