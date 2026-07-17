-- Custom SQL migration file, put your code below! --
-- F56-S31 — Prompt como código (AUDITORIA_TECNICA §3.3, AG-04).
--
-- `agent_prompt_versions`: histórico append-only + staging do "cérebro" do agente.
-- `agents.system_prompt` continua sendo o prompt LIVE (o que o runtime lê); esta
-- tabela guarda draft/live/archived, habilitando publicação explícita draft→live,
-- diff e rollback.
--
-- RLS: workspace_id próprio (denormalizado) → isolamento direto por
-- current_setting('app.workspace_id', true)::uuid. hm_app (sujeito a RLS) recebe DML;
-- o owner (migrate/seed) bypassa. Espelha products/agent_departments (0052/0042).
-- FORCE ROW LEVEL SECURITY: a RLS vale até para o DONO da tabela (fecha o bypass do
-- owner em prod), espelhando 0062.

CREATE TABLE IF NOT EXISTS agent_prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  system_prompt text NOT NULL,
  model text,
  model_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  label text,
  note text,
  author_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  rolled_back_from integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT agent_prompt_versions_status_chk
    CHECK (status IN ('draft','live','archived')),
  CONSTRAINT uq_agent_prompt_versions_agent_version UNIQUE (agent_id, version)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_agent_prompt_versions_agent
  ON agent_prompt_versions (agent_id, version DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_agent_prompt_versions_workspace
  ON agent_prompt_versions (workspace_id);
--> statement-breakpoint

-- NO MÁXIMO 1 live por agente — o banco é a garantia final (não confiamos só na app).
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_prompt_versions_one_live_per_agent
  ON agent_prompt_versions (agent_id)
  WHERE status = 'live';
--> statement-breakpoint

-- ─── RLS ─────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_prompt_versions TO hm_app;
ALTER TABLE agent_prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_prompt_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_prompt_versions_isolation ON agent_prompt_versions;
CREATE POLICY agent_prompt_versions_isolation ON agent_prompt_versions
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
