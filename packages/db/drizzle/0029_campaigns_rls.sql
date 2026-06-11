-- Custom SQL migration file, put your code below! --
-- F6-S01: indices parciais + RLS do dominio Campaigns (DATA_MODEL 11 + CAMPAIGNS.md 8.4).
-- Tabelas tenant (workspace_id): campaigns, campaign_recipients, campaign_deliveries,
-- campaign_metrics, scheduled_followups -> RLS direto.
-- campaign_steps / campaign_followups NAO tem workspace_id -> isoladas via subquery em
-- campaigns (espelha agent_tools / flow_versions). hm_app sofre RLS; owner bypassa.

-- --- Indice parcial: tick so varre campanhas RUNNING (hot path do worker) ---
CREATE INDEX idx_campaigns_running_tick
  ON campaigns(next_tick_at)
  WHERE status = 'running';
--> statement-breakpoint

-- --- Indice parcial: fila duravel processa apenas followups agendados pendentes ---
CREATE INDEX idx_scheduled_followups_pending
  ON scheduled_followups(scheduled_at)
  WHERE status = 'scheduled';
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns TO hm_app;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaigns_isolation ON campaigns
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_recipients TO hm_app;
ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaign_recipients_isolation ON campaign_recipients
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_deliveries TO hm_app;
ALTER TABLE campaign_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaign_deliveries_isolation ON campaign_deliveries
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_metrics TO hm_app;
ALTER TABLE campaign_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaign_metrics_isolation ON campaign_metrics
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_followups TO hm_app;
ALTER TABLE scheduled_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY scheduled_followups_isolation ON scheduled_followups
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

-- campaign_steps: sem workspace_id proprio -> isola via campanha dona
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_steps TO hm_app;
ALTER TABLE campaign_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaign_steps_isolation ON campaign_steps
  USING (
    EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = campaign_steps.campaign_id
        AND c.workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = campaign_steps.campaign_id
        AND c.workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  );
--> statement-breakpoint

-- campaign_followups: sem workspace_id proprio -> isola via campanha dona
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_followups TO hm_app;
ALTER TABLE campaign_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaign_followups_isolation ON campaign_followups
  USING (
    EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = campaign_followups.campaign_id
        AND c.workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = campaign_followups.campaign_id
        AND c.workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  );
--> statement-breakpoint
