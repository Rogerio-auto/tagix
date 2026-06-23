-- Custom SQL migration file, put your code below! --
-- RLS do domínio F43 (Onboarding / Verticalização).
--
-- quick_replies: workspace-scoped -> isolamento direto por
-- current_setting('app.workspace_id'). O hm_app recebe DML por grant explícito
-- (espelha o padrão dos demais domínios). As colunas workspaces.onboarding e
-- members.tour_state herdam o RLS já existente dessas tabelas (nada a fazer aqui).

GRANT SELECT, INSERT, UPDATE, DELETE ON quick_replies TO hm_app;
ALTER TABLE quick_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY quick_replies_isolation ON quick_replies
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
