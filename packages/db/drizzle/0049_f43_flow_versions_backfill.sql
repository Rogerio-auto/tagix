-- F43 fix: backfill de flow_versions para flows ATIVOS sem version publicada.
--
-- O instanciador de Niche Blueprint (seed/niches/instantiate.ts) inseria flows com
-- status='active' e nodes/edges inline, porém NUNCA criava a flow_version correspondente.
-- A engine (createExecution em @hm/flow-engine) referencia a VERSION, não o flow; sem ela,
-- todo trigger desses templates de nicho falhava com "flow sem version publicada" -> 500.
--
-- Esta migration repara workspaces JÁ provisionados (produção inclusa), materializando a
-- version 1 a partir do snapshot atual do flow (nodes/edges/trigger_config). É idempotente:
-- só atinge flows ativos que não possuem NENHUMA version. published_by fica NULL (backfill
-- de sistema, sem membro autor). O fix de código (instantiate.ts) evita o problema daqui pra
-- frente para novos workspaces.

INSERT INTO "flow_versions" ("flow_id", "version", "nodes", "edges", "trigger_config", "published_at")
SELECT f."id", 1, f."nodes", f."edges", f."trigger_config", now()
FROM "flows" f
WHERE f."status" = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM "flow_versions" v WHERE v."flow_id" = f."id"
  );
