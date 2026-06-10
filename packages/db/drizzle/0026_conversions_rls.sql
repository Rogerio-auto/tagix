-- Custom SQL migration file, put your code below! --
-- F5-S03: RLS + indices funcionais/parciais do dominio Conversoes (DATA_MODEL 10.7).
-- drizzle-kit nao expressa date_trunc nem partial-WHERE via schema -> aqui.

-- --- Indices parciais de atribuicao (todos WHERE cancelled_at IS NULL) ---
CREATE INDEX idx_conv_events_workspace_occurred
  ON conversion_events(workspace_id, occurred_at DESC)
  WHERE cancelled_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_conv_events_member
  ON conversion_events(triggered_by_member_id, occurred_at DESC)
  WHERE cancelled_at IS NULL AND triggered_by_member_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_conv_events_agent
  ON conversion_events(triggered_by_agent_id, occurred_at DESC)
  WHERE cancelled_at IS NULL AND triggered_by_agent_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_conv_events_type
  ON conversion_events(conversion_type_id, occurred_at DESC)
  WHERE cancelled_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_conv_events_attribution_campaign
  ON conversion_events(attributed_campaign_id, occurred_at DESC)
  WHERE cancelled_at IS NULL AND attributed_campaign_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_conv_events_contact
  ON conversion_events(contact_id, occurred_at DESC)
  WHERE cancelled_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_conversion_types_workspace
  ON conversion_types(workspace_id)
  WHERE is_active = true;
--> statement-breakpoint

-- --- Dedup casual: mesmo contato + tipo + dia (so eventos nao cancelados) ---
CREATE UNIQUE INDEX uq_conv_events_dedup
  ON conversion_events(workspace_id, contact_id, conversion_type_id, ((occurred_at AT TIME ZONE 'UTC')::date))
  WHERE cancelled_at IS NULL;
--> statement-breakpoint

-- --- RLS (tenant-scoped por workspace_id) ---
GRANT SELECT, INSERT, UPDATE, DELETE ON conversion_types TO hm_app;
ALTER TABLE conversion_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversion_types_isolation ON conversion_types
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON conversion_events TO hm_app;
ALTER TABLE conversion_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversion_events_isolation ON conversion_events
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON conversion_tag_triggers TO hm_app;
ALTER TABLE conversion_tag_triggers ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversion_tag_triggers_isolation ON conversion_tag_triggers
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
