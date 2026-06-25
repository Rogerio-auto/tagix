-- Custom SQL migration file, put your code below! --
-- F48-S01: materialized view mv_dashboard_daily_30d — séries diárias de desempenho
-- (janela móvel de 30 dias) para os gráficos temporais do Command Center v2
-- (DASHBOARD §5/§9.3). Uma linha por (workspace_id, day): conversas resolvidas,
-- conversões (nº + valor) e novos contatos. MV pré-agregada evita query pesada no load.
--
-- Combina 3 CTEs diárias via FULL OUTER JOIN em (workspace_id, day) — um dia pode ter
-- evento em só uma das fontes; coalesce(...,0) preenche os ausentes. Não há resolved_at
-- no schema: conversa resolvida usa updated_at (consistente com performancePorAtendente /
-- tempoMedioResolucao24h). MV é global (sem RLS) — a leitura (S02) sempre adiciona
-- WHERE workspace_id = $1; segue o contrato das MVs do 0033_f8_mv_rls_fk.sql.
CREATE MATERIALIZED VIEW "mv_dashboard_daily_30d" AS
WITH resolved AS (
  SELECT
    c.workspace_id,
    date_trunc('day', c.updated_at)::date AS day,
    count(*)::int AS resolvidas
  FROM conversations c
  WHERE c.status IN ('resolved', 'closed')
    AND c.updated_at IS NOT NULL
    AND c.updated_at > now() - interval '30 days'
  GROUP BY c.workspace_id, date_trunc('day', c.updated_at)::date
),
conversions AS (
  SELECT
    e.workspace_id,
    date_trunc('day', e.occurred_at)::date AS day,
    count(*)::int AS conversoes,
    coalesce(sum(e.value_cents), 0)::bigint AS conversoes_valor_cents
  FROM conversion_events e
  WHERE e.cancelled_at IS NULL
    AND e.occurred_at > now() - interval '30 days'
  GROUP BY e.workspace_id, date_trunc('day', e.occurred_at)::date
),
new_contacts AS (
  SELECT
    ct.workspace_id,
    date_trunc('day', ct.created_at)::date AS day,
    count(*)::int AS novos_contatos
  FROM contacts ct
  WHERE ct.deleted_at IS NULL
    AND ct.created_at > now() - interval '30 days'
  GROUP BY ct.workspace_id, date_trunc('day', ct.created_at)::date
)
SELECT
  coalesce(r.workspace_id, cv.workspace_id, nc.workspace_id) AS workspace_id,
  coalesce(r.day, cv.day, nc.day) AS day,
  coalesce(r.resolvidas, 0) AS resolvidas,
  coalesce(cv.conversoes, 0) AS conversoes,
  coalesce(cv.conversoes_valor_cents, 0)::bigint AS conversoes_valor_cents,
  coalesce(nc.novos_contatos, 0) AS novos_contatos
FROM resolved r
FULL OUTER JOIN conversions cv
  ON r.workspace_id = cv.workspace_id AND r.day = cv.day
FULL OUTER JOIN new_contacts nc
  ON coalesce(r.workspace_id, cv.workspace_id) = nc.workspace_id
  AND coalesce(r.day, cv.day) = nc.day;
--> statement-breakpoint
-- UNIQUE p/ REFRESH ... CONCURRENTLY (exige índice único cobrindo cada linha).
CREATE UNIQUE INDEX "mv_dashboard_daily_30d_uq"
  ON "mv_dashboard_daily_30d" ("workspace_id", "day");
--> statement-breakpoint
-- MV lida pelo app (hm_app sofre RLS, mas MV não suporta RLS; o filtro de workspace é
-- responsabilidade da query do serviço de métricas — S02). Concede leitura ao papel da app.
GRANT SELECT ON "mv_dashboard_daily_30d" TO hm_app;
