-- F56-S13 (INF-04/INF-05) — flow_executions: claim atomico + anti-loop.
--
-- 1) `step_count`: total de steps executados pela execucao. Incrementado ATOMICAMENTE
--    pelo claim do dispatcher (@hm/flow-engine); a engine falha a execucao ("loop
--    suspeito") ao exceder o teto — um flow ciclico deixa de flodar a fila (INF-05).
-- 2) status `processing`: estado de step reivindicado. O dispatcher so processa um
--    envelope se o UPDATE condicional (running|waiting-vencida|processing-vencido)
--    reivindicar a linha — dois envelopes concorrentes do mesmo execution_id deixam
--    de executar em paralelo (INF-04). Lease: `updated_at` do claim; takeover apos
--    expirar recupera crash no meio do step.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + DROP CONSTRAINT IF EXISTS antes do ADD.
ALTER TABLE "flow_executions" ADD COLUMN IF NOT EXISTS "step_count" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "flow_executions" DROP CONSTRAINT IF EXISTS "flow_executions_status_chk";--> statement-breakpoint
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_status_chk" CHECK ("flow_executions"."status" in ('running','waiting','processing','completed','failed','cancelled'));
