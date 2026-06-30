-- Custom SQL migration file, put your code below! --
-- F55-S03: recriar mv_dashboard_daily_30d para contar "resolvidas" pelo timestamp REAL de
-- resolução (`conversations.resolved_at`, criado na 0059/S01) em vez do proxy `updated_at`.
-- A série diária de desempenho (30 dias) passa a refletir resolução de verdade: cada conversa
-- conta no dia em que foi resolvida (resolved_at), independente de status atual (uma conversa
-- resolvida hoje e reaberta amanhã ainda pontua hoje). resolved_at IS NOT NULL é o marcador
-- autoritativo de resolução — substitui o filtro status IN ('resolved','closed') + updated_at.
--
-- A view tem o MESMO nome → o worker de refresh (mv-refresh-job.ts) e a leitura
-- (serieDesempenho30d) seguem inalterados. As demais colunas (conversoes / valor /
-- novos_contatos) são IDÊNTICAS à 0054. Recriamos o unique index (exigido por REFRESH ...
-- CONCURRENTLY) e o GRANT SELECT TO hm_app, espelhando exatamente a 0054. MV continua global
-- (sem RLS) — o filtro WHERE workspace_id é responsabilidade da query do serviço de métricas.
DROP MATERIALIZED VIEW IF EXISTS "mv_dashboard_daily_30d";
--> statement-breakpoint
CREATE MATERIALIZED VIEW "mv_dashboard_daily_30d" AS
WITH resolved AS (
  SELECT
    c.workspace_id,
    date_trunc('day', c.resolved_at)::date AS day,
    count(*)::int AS resolvidas
  FROM conversations c
  WHERE c.resolved_at IS NOT NULL
    AND c.resolved_at > now() - interval '30 days'
  GROUP BY c.workspace_id, date_trunc('day', c.resolved_at)::date
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
-- responsabilidade da query do serviço de métricas). Concede leitura ao papel da app.
GRANT SELECT ON "mv_dashboard_daily_30d" TO hm_app;
