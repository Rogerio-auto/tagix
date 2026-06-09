-- RLS do núcleo LiveChat (F1-S05). Todas têm workspace_id → policy padrão de isolamento.
GRANT SELECT, INSERT, UPDATE, DELETE ON contacts, conversations, messages TO hm_app;

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contacts_isolation ON contacts
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversations_isolation ON conversations
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_isolation ON messages
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
