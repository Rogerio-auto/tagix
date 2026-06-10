-- Custom SQL migration file, put your code below! --
-- RLS do dominio Flow Builder (F4-S01). Convencao F1/F2/F3 (ex.: 0018_kb_rls):
--   * tabelas tenant-scoped (workspace_id) -> ENABLE RLS + policy de isolamento por
--     current_setting('app.workspace_id', true)::uuid.
--   * flow_versions NAO tem workspace_id proprio -> isolada via subquery na tabela
--     `flows` (mesmo workspace do flow dono), espelhando o padrao de agent_tools.
-- O papel hm_app (sujeito a RLS) recebe DML; o owner (migrate/seed) bypassa RLS.

-- --- Tenant-scoped (workspace_id) -> RLS de isolamento direto ---
GRANT SELECT, INSERT, UPDATE, DELETE ON flows TO hm_app;
ALTER TABLE flows ENABLE ROW LEVEL SECURITY;
CREATE POLICY flows_isolation ON flows
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON flow_executions TO hm_app;
ALTER TABLE flow_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY flow_executions_isolation ON flow_executions
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON flow_logs TO hm_app;
ALTER TABLE flow_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY flow_logs_isolation ON flow_logs
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON flow_submissions TO hm_app;
ALTER TABLE flow_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY flow_submissions_isolation ON flow_submissions
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

-- --- flow_versions: sem workspace_id proprio -> isola via flow dono ---
GRANT SELECT, INSERT, UPDATE, DELETE ON flow_versions TO hm_app;
ALTER TABLE flow_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY flow_versions_isolation ON flow_versions
  USING (
    EXISTS (
      SELECT 1 FROM flows f
      WHERE f.id = flow_versions.flow_id
        AND f.workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM flows f
      WHERE f.id = flow_versions.flow_id
        AND f.workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  );
