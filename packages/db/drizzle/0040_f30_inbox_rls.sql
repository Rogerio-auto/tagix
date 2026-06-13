-- Custom SQL migration file, put your code below! --
-- RLS do dominio Inbox visibility (F30-S01 / LIVECHAT_OPS §1). Convencao do repo:
-- ambas as tabelas tem workspace_id proprio -> isolamento direto por
-- current_setting('app.workspace_id', true)::uuid. O papel hm_app (sujeito a RLS)
-- recebe DML; o owner (migrate/seed) bypassa RLS.

GRANT SELECT, INSERT, UPDATE, DELETE ON inbox_visibility_settings TO hm_app;
ALTER TABLE inbox_visibility_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY inbox_visibility_settings_isolation ON inbox_visibility_settings
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON member_visibility_overrides TO hm_app;
ALTER TABLE member_visibility_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_visibility_overrides_isolation ON member_visibility_overrides
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
