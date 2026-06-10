-- Custom SQL migration file, put your code below! --
-- RLS do domínio de agentes (F2-S01). Convenção da F1 (ex.: 0011_*_rls):
--   * tabelas tenant-scoped (workspace_id) → ENABLE RLS + policy de isolamento por
--     current_setting('app.workspace_id', true)::uuid.
--   * tabelas GLOBAIS/plataforma (sem workspace_id) → SEM policy de tenant; legíveis
--     por todos (catálogos). Apenas o GRANT para o papel hm_app.
--   * agent_tools não tem workspace_id próprio → isolada por subquery na tabela
--     `agents` (mesmo workspace do agente dono).
--
-- O papel hm_app (sujeito a RLS) recebe DML; o owner (migrate/seed) bypassa RLS.

-- ─── Catálogos GLOBAIS (sem RLS de tenant; leitura para todos) ────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_templates TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_template_questions TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tools TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON llm_models_whitelist TO hm_app;

-- ─── Tenant-scoped (workspace_id) → RLS de isolamento ─────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON agents TO hm_app;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY agents_isolation ON agents
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_metrics TO hm_app;
ALTER TABLE agent_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_metrics_isolation ON agent_metrics
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_agent_policies TO hm_app;
ALTER TABLE workspace_agent_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_agent_policies_isolation ON workspace_agent_policies
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON tool_logs TO hm_app;
ALTER TABLE tool_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tool_logs_isolation ON tool_logs
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_executions TO hm_app;
ALTER TABLE agent_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_executions_isolation ON agent_executions
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON llm_usage_logs TO hm_app;
ALTER TABLE llm_usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY llm_usage_logs_isolation ON llm_usage_logs
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- ─── agent_tools: sem workspace_id próprio → isola via agente dono ─────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_tools TO hm_app;
ALTER TABLE agent_tools ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_tools_isolation ON agent_tools
  USING (
    EXISTS (
      SELECT 1 FROM agents a
      WHERE a.id = agent_tools.agent_id
        AND a.workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agents a
      WHERE a.id = agent_tools.agent_id
        AND a.workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  );
