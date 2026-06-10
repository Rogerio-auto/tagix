-- RLS do ig_comments (F1-S06). Tem workspace_id → policy padrão de isolamento. Owner/seed bypassa.
GRANT SELECT, INSERT, UPDATE, DELETE ON ig_comments TO hm_app;

ALTER TABLE ig_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY ig_comments_isolation ON ig_comments
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
