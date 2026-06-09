-- RLS multi-tenant (DATA_MODEL §3.4). Isolamento por workspace via
-- current_setting('app.workspace_id'). A app usa o papel hm_app (sujeito a RLS);
-- migrations/seed rodam como owner (que bypassa). Default-deny quando a GUC não está setada.

-- Papel da aplicação (sem BYPASSRLS).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hm_app') THEN
    CREATE ROLE hm_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hm_app;

-- workspaces: isola pelo próprio id.
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspaces_isolation ON workspaces
  USING (id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (id = current_setting('app.workspace_id', true)::uuid);

-- tabelas com workspace_id.
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
CREATE POLICY members_isolation ON members
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_keys_isolation ON api_keys
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_isolation ON subscriptions
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- audit_logs: workspace_id pode ser null (platform-level) — só o owner/bypass vê esses.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_isolation ON audit_logs
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
