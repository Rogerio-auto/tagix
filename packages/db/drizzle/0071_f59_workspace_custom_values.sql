-- F59-S07 — valores personalizados por workspace (AGENCIA_PLAN.md §3.4).
--
-- `{{nome_empresa}}`, `{{link_review}}`, `{{meta_dataset_id}}` referenciados
-- dentro de flows, prompts de agente, campanhas e e-mails. Trocar de cliente
-- vira editar N variaveis num lugar em vez de cacar a mesma string em cinco
-- automacoes — e o pre-requisito do template de workspace.

CREATE TABLE IF NOT EXISTS workspace_custom_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  -- Cifrado em repouso quando kind = 'secret' (AES-256-GCM, mesmo dos canais).
  value text NOT NULL,
  kind text NOT NULL DEFAULT 'text',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  CONSTRAINT workspace_custom_values_kind_chk CHECK (kind IN ('text','url','secret')),
  -- A chave aparece dentro de {{...}}: previsivel de digitar, sem acento nem espaco.
  CONSTRAINT workspace_custom_values_key_chk CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$')
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_custom_values_key
  ON workspace_custom_values (workspace_id, key);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_workspace_custom_values_ws
  ON workspace_custom_values (workspace_id);
--> statement-breakpoint

ALTER TABLE workspace_custom_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_custom_values FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_custom_values_isolation ON workspace_custom_values;
CREATE POLICY workspace_custom_values_isolation ON workspace_custom_values
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
