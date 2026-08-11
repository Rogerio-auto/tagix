-- F58-S02 — catálogo local de modelos de mensagem do WhatsApp oficial.
--
-- O catálogo é um cache operacional da Meta. Status/categoria ficam como text e os
-- componentes como jsonb-array para tolerar evolução do provider sem perder dados.
-- O estado de sincronização vive separado para preservar o último sucesso quando a
-- resposta é vazia ou quando uma tentativa posterior falha.

-- Uma FK composta (workspace_id, channel_id) só pode apontar para colunas únicas.
-- Além de habilitar a FK abaixo, esta chave garante que a identidade de tenant do
-- canal faça parte do contrato referencial (e não dependa apenas da aplicação).
CREATE UNIQUE INDEX IF NOT EXISTS uq_channels_workspace_id
  ON channels (workspace_id, id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS channel_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL,
  external_id text NOT NULL,
  name text NOT NULL,
  language text NOT NULL,
  category text NOT NULL,
  status text NOT NULL,
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  rejection_reason text,
  is_available boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  CONSTRAINT channel_message_templates_workspace_channel_fk
    FOREIGN KEY (workspace_id, channel_id)
    REFERENCES channels(workspace_id, id)
    ON DELETE CASCADE,
  CONSTRAINT channel_message_templates_components_array_chk
    CHECK (jsonb_typeof(components) = 'array')
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_message_templates_channel_name_language
  ON channel_message_templates (channel_id, name, language);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_message_templates_channel_external
  ON channel_message_templates (channel_id, external_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_channel_message_templates_workspace_channel
  ON channel_message_templates (workspace_id, channel_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_channel_message_templates_channel_status
  ON channel_message_templates (workspace_id, channel_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_channel_message_templates_channel_category
  ON channel_message_templates (workspace_id, channel_id, category);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS channel_message_template_sync_states (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id uuid PRIMARY KEY,
  sync_status text NOT NULL DEFAULT 'idle',
  last_attempt_at timestamptz,
  last_successful_sync_at timestamptz,
  last_failed_at timestamptz,
  last_error text,
  last_item_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  CONSTRAINT channel_message_template_sync_states_workspace_channel_fk
    FOREIGN KEY (workspace_id, channel_id)
    REFERENCES channels(workspace_id, id)
    ON DELETE CASCADE,
  CONSTRAINT channel_message_template_sync_states_item_count_chk
    CHECK (last_item_count IS NULL OR last_item_count >= 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_channel_message_template_sync_states_workspace
  ON channel_message_template_sync_states (workspace_id);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON channel_message_templates TO hm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON channel_message_template_sync_states TO hm_app;
--> statement-breakpoint

ALTER TABLE channel_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_message_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channel_message_templates_isolation ON channel_message_templates;
CREATE POLICY channel_message_templates_isolation ON channel_message_templates
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint

ALTER TABLE channel_message_template_sync_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_message_template_sync_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channel_message_template_sync_states_isolation
  ON channel_message_template_sync_states;
CREATE POLICY channel_message_template_sync_states_isolation
  ON channel_message_template_sync_states
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
