-- Custom SQL migration file, put your code below! --
-- RLS de routing_history (F1-S23). Tabela tenant-scoped (workspace_id) →
-- policy padrão de isolamento + grant ao papel hm_app (sujeito a RLS).
GRANT SELECT, INSERT, UPDATE, DELETE ON routing_history TO hm_app;

ALTER TABLE routing_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY routing_history_isolation ON routing_history
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
