-- Custom SQL migration file, put your code below! --
-- RLS do domínio Knowledge Base (F3-S01). Convenção F1/F2:
--   * tabelas tenant-scoped (workspace_id) → ENABLE RLS + policy de isolamento por
--     current_setting('app.workspace_id', true)::uuid.
-- As 3 tabelas têm workspace_id próprio → isolamento direto (sem subquery).
-- O papel hm_app (sujeito a RLS) recebe DML; o owner (migrate/seed) bypassa RLS.

GRANT SELECT, INSERT, UPDATE, DELETE ON kb_documents TO hm_app;
ALTER TABLE kb_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY kb_documents_isolation ON kb_documents
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON kb_chunks TO hm_app;
ALTER TABLE kb_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY kb_chunks_isolation ON kb_chunks
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON kb_feedback TO hm_app;
ALTER TABLE kb_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY kb_feedback_isolation ON kb_feedback
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
