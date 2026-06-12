CREATE TABLE "data_export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"requested_by" uuid,
	"scope" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"artifact_key" text,
	"artifact_bytes" text,
	"error" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "data_export_jobs_status_chk" CHECK ("data_export_jobs"."status" in ('pending','processing','done','failed'))
);
--> statement-breakpoint
ALTER TABLE "data_export_jobs" ADD CONSTRAINT "data_export_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_export_jobs" ADD CONSTRAINT "data_export_jobs_requested_by_members_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_data_export_jobs_pending" ON "data_export_jobs" USING btree ("created_at") WHERE "data_export_jobs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_data_export_jobs_workspace" ON "data_export_jobs" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint

-- ─── RLS de data_export_jobs (F10-S02 / LGPD) ─────────────────────────────────
-- workspace_id próprio → isolamento direto. hm_app sofre RLS; o owner (migrate/seed)
-- e o processador de export (que roda com app.workspace_id setado por job, via
-- withWorkspace) operam dentro do tenant. Mesmo padrão das tabelas da F8/F9.
GRANT SELECT, INSERT, UPDATE, DELETE ON data_export_jobs TO hm_app;--> statement-breakpoint
ALTER TABLE data_export_jobs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY data_export_jobs_isolation ON data_export_jobs
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);