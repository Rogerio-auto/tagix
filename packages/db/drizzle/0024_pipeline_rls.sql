-- Custom SQL migration file, put your code below! --
-- RLS do dominio Pipeline (F5-S02). Todas as 6 tabelas sao tenant-scoped
-- (workspace_id) -> ENABLE RLS + policy de isolamento por
-- current_setting('app.workspace_id', true)::uuid. Convencao F1-F4 (ex.: 0020/0022).
-- hm_app (sujeito a RLS) recebe DML; owner (migrate/seed) bypassa.

GRANT SELECT, INSERT, UPDATE, DELETE ON pipelines TO hm_app;
ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY pipelines_isolation ON pipelines
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON stages TO hm_app;
ALTER TABLE stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY stages_isolation ON stages
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON deals TO hm_app;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY deals_isolation ON deals
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON deal_history TO hm_app;
ALTER TABLE deal_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY deal_history_isolation ON deal_history
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON deal_attachments TO hm_app;
ALTER TABLE deal_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY deal_attachments_isolation ON deal_attachments
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON pending_automations TO hm_app;
ALTER TABLE pending_automations ENABLE ROW LEVEL SECURITY;
CREATE POLICY pending_automations_isolation ON pending_automations
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
