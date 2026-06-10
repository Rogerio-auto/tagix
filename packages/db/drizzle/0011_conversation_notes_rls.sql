-- Custom SQL migration file, put your code below! --
-- RLS de conversation_notes (F1-S22). Tabela tenant-scoped (workspace_id) →
-- policy padrão de isolamento + grant ao papel hm_app (sujeito a RLS).
GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_notes TO hm_app;

ALTER TABLE conversation_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversation_notes_isolation ON conversation_notes
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);