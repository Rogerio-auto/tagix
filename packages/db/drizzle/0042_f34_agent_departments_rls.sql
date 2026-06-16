-- Custom SQL migration file, put your code below! --
-- RLS do vinculo agente<->departamento (F34-S01 / AGENT_DEPARTMENT_ROUTING_PLAN
-- par.4.1). Convencao do repo: agent_departments tem workspace_id proprio
-- (denormalizado, espelha team_members) -> isolamento direto por
-- current_setting('app.workspace_id', true)::uuid. O papel hm_app (sujeito a RLS)
-- recebe DML; o owner (migrate/seed) bypassa RLS.

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_departments TO hm_app;
ALTER TABLE agent_departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_departments_isolation ON agent_departments
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
