-- Custom SQL migration file, put your code below! --
-- F8-S01: infra de dashboard + org. Três partes:
--   (A) FK backfill — conversations.department_id/team_id e calendars.team_id agora
--       que departments/teams existem (eram uuid soltos esperando as tabelas).
--   (B) Materialized views mv_dashboard_* (tendências pesadas 1h/1d — DASHBOARD §5/§9.3,
--       DATA_MODEL §15). Drizzle não modela MV → custom. UNIQUE index em cada uma p/
--       permitir REFRESH ... CONCURRENTLY pelo job.
--   (C) RLS das 5 tabelas novas (departments/teams/team_members/sla_rules/
--       dashboard_snapshots) — todas com workspace_id próprio → isolamento direto.
--       hm_app sofre RLS; owner (migrate/seed) bypassa. + partial unique p/ o default
--       de sla_rules (NULL não é único em UNIQUE comum).

-- ─── (A) Backfill de FKs ──────────────────────────────────────────────────────
-- As colunas já existiam (conversations/calendars). Adicionamos as constraints
-- agora. ON DELETE SET NULL: apagar um department/team não apaga a conversa/agenda.
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_department_id_departments_id_fk"
  FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_team_id_teams_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendars"
  ADD CONSTRAINT "calendars_team_id_teams_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Índices p/ os agrupamentos do dashboard (inbox_por_departamento) e joins de team.
CREATE INDEX IF NOT EXISTS "idx_conversations_department"
  ON "conversations" ("workspace_id", "department_id") WHERE "department_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_team"
  ON "conversations" ("workspace_id", "team_id") WHERE "team_id" IS NOT NULL;
--> statement-breakpoint

-- ─── (B) Materialized views (DATA_MODEL §15 + DASHBOARD §2/§5) ─────────────────
-- B.1 volume de mensagens nas últimas 24h, por workspace × hora × direção.
--     Alimenta volume_inbound_24h / volume_outbound_24h (cadência 1h).
CREATE MATERIALIZED VIEW "mv_dashboard_volume_24h" AS
SELECT
  m.workspace_id,
  date_trunc('hour', m.created_at) AS bucket_hour,
  m.direction,
  count(*)::bigint AS message_count
FROM messages m
WHERE m.created_at > now() - interval '24 hours'
GROUP BY m.workspace_id, date_trunc('hour', m.created_at), m.direction;
--> statement-breakpoint
-- UNIQUE p/ REFRESH ... CONCURRENTLY (exige índice único cobrindo cada linha).
CREATE UNIQUE INDEX "mv_dashboard_volume_24h_uq"
  ON "mv_dashboard_volume_24h" ("workspace_id", "bucket_hour", "direction");
--> statement-breakpoint

-- B.2 custo LLM do mês corrente, por workspace. Alimenta custo_llm_mes (cadência 1d).
CREATE MATERIALIZED VIEW "mv_dashboard_llm_cost_month" AS
SELECT
  l.workspace_id,
  date_trunc('month', now()) AS month_start,
  coalesce(sum(l.cost_usd), 0)::numeric(18, 8) AS cost_usd,
  coalesce(sum(l.total_tokens), 0)::bigint AS total_tokens,
  count(*)::bigint AS request_count
FROM llm_usage_logs l
WHERE l.created_at >= date_trunc('month', now())
GROUP BY l.workspace_id;
--> statement-breakpoint
CREATE UNIQUE INDEX "mv_dashboard_llm_cost_month_uq"
  ON "mv_dashboard_llm_cost_month" ("workspace_id");
--> statement-breakpoint

-- B.3 conversões do mês corrente, por workspace × tipo. Alimenta os cards de
--     conversões agregadas (só aparecem se o workspace tem conversion_type — §13).
CREATE MATERIALIZED VIEW "mv_dashboard_conversions_month" AS
SELECT
  e.workspace_id,
  e.conversion_type_id,
  date_trunc('month', now()) AS month_start,
  count(*)::bigint AS conversion_count,
  coalesce(sum(e.value_cents), 0)::bigint AS value_cents
FROM conversion_events e
WHERE e.occurred_at >= date_trunc('month', now())
GROUP BY e.workspace_id, e.conversion_type_id;
--> statement-breakpoint
CREATE UNIQUE INDEX "mv_dashboard_conversions_month_uq"
  ON "mv_dashboard_conversions_month" ("workspace_id", "conversion_type_id");
--> statement-breakpoint
-- MVs lidas pelo app (hm_app sofre RLS, mas MV não suporta RLS; aqui o filtro de
-- workspace é responsabilidade da query do serviço de métricas, que sempre adiciona
-- WHERE workspace_id = app.workspace_id). Concede leitura ao papel da app.
GRANT SELECT ON "mv_dashboard_volume_24h" TO hm_app;
--> statement-breakpoint
GRANT SELECT ON "mv_dashboard_llm_cost_month" TO hm_app;
--> statement-breakpoint
GRANT SELECT ON "mv_dashboard_conversions_month" TO hm_app;
--> statement-breakpoint

-- ─── (C) RLS das tabelas novas ────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON departments TO hm_app;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY departments_isolation ON departments
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON teams TO hm_app;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY teams_isolation ON teams
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON team_members TO hm_app;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_members_isolation ON team_members
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON sla_rules TO hm_app;
ALTER TABLE sla_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY sla_rules_isolation ON sla_rules
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint
-- O default do workspace (scope_type='workspace', scope_id NULL) precisa ser único:
-- UNIQUE comum trata NULLs como distintos, logo um partial unique garante ≤1 default.
CREATE UNIQUE INDEX "sla_rules_workspace_default_uq"
  ON "sla_rules" ("workspace_id") WHERE "scope_type" = 'workspace';
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON dashboard_snapshots TO hm_app;
ALTER TABLE dashboard_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY dashboard_snapshots_isolation ON dashboard_snapshots
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);