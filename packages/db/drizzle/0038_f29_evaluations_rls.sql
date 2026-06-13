-- Custom SQL migration file, put your code below! --
-- RLS do dominio Agent quality / CSAT / objecoes (F29-S01). Convencao do repo:
--   * tabelas tenant-scoped (workspace_id) -> ENABLE RLS + policy de isolamento por
--     current_setting('app.workspace_id', true)::uuid.
-- Ambas as tabelas tem workspace_id proprio -> isolamento direto (sem subquery).
-- O papel hm_app (sujeito a RLS) recebe DML; o owner (migrate/seed) bypassa RLS.

GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_evaluations TO hm_app;
ALTER TABLE conversation_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversation_evaluations_isolation ON conversation_evaluations
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON objections TO hm_app;
ALTER TABLE objections ENABLE ROW LEVEL SECURITY;
CREATE POLICY objections_isolation ON objections
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
