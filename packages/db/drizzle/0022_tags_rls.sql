-- Custom SQL migration file, put your code below! --
-- RLS do dominio Tags (F5-S01). Convencao F1/F2/F3/F4 (ex.: 0020_flows_rls):
--   tabelas tenant-scoped (workspace_id) -> ENABLE RLS + policy de isolamento por
--   current_setting('app.workspace_id', true)::uuid.
-- contact_tags nao tem workspace_id em DATA_MODEL §5.2; aqui foi denormalizado p/
-- isolamento direto (mais rapido no hot-path de tagging que subquery em contacts).
-- O papel hm_app (sujeito a RLS) recebe DML; o owner (migrate/seed) bypassa RLS.

GRANT SELECT, INSERT, UPDATE, DELETE ON tags TO hm_app;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY tags_isolation ON tags
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON contact_tags TO hm_app;
ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_tags_isolation ON contact_tags
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
