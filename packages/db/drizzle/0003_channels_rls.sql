-- RLS dos canais (F1-S01). channels isola por workspace_id; channel_secrets
-- (sem workspace_id) isola via subquery no channel. Owner/seed bypassa.

GRANT SELECT, INSERT, UPDATE, DELETE ON channels, channel_secrets TO hm_app;

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY channels_isolation ON channels
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE channel_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY channel_secrets_isolation ON channel_secrets
  USING (
    channel_id IN (
      SELECT id FROM channels WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  )
  WITH CHECK (
    channel_id IN (
      SELECT id FROM channels WHERE workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  );
