-- F56-S03 — Maquina de estados do recipient de campanha (AUDITORIA_TECNICA §3.4:
-- CAMP-03 drip / CAMP-04 estado terminal / CAMP-06 teto diario) + DB-04 (indice do
-- tick). Migration 100% idempotente: pode re-rodar em qualquer ambiente.
--
-- (A) Colunas novas em campaign_recipients:
--     next_step_at  — quando o PROXIMO step fica devido (= last_step_at + delay_seconds).
--                     NULL = devido agora (recipient recem-importado).
--     completed_at  — carimbo do estado terminal do recipient.
--     attempts      — tentativas de despacho do step corrente (claim + backoff,
--                     mesmo padrao de scheduled_followups).
--
-- (B) Indices:
--     idx_campaign_recipients_due    — eixo do batch do tick (campaign, status, due).
--     idx_campaigns_next_tick_running — DB-04: o tick varre CROSS-TENANT por
--                     next_tick_at vencido; parcial so nas RUNNING.
--
-- (C) HEAL do dado legado: o bug CAMP-03 deixou recipients presos em `sending`
--     (viravam `sending` no 1o dispatch e ninguem os tirava de la). Aqui eles
--     voltam para a maquina de estados correta:
--       - sem proximo step  -> `completed` (o passo deles ja saiu);
--       - com proximo step  -> `pending` agendado em last_step_at + delay_seconds.
--     Nenhum reenvio e disparado: campaign_deliveries.idempotency_key continua
--     barrando duplicata do step ja despachado.
--
-- NOTA (CONCURRENTLY): o runner (drizzle migrator) roda tudo numa transacao,
-- entao CREATE INDEX CONCURRENTLY e impossivel aqui. Ops pode pre-criar os
-- indices com CONCURRENTLY (mesmos nomes) antes do deploy — como e idempotente,
-- a migration vira no-op.

-- ─── (A) Colunas ─────────────────────────────────────────────────────────────

ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "next_step_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

-- ─── (B) Indices ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "idx_campaign_recipients_due"
  ON "campaign_recipients" ("campaign_id", "status", "next_step_at");
--> statement-breakpoint

-- DB-04: elimina o seq scan do tick de campanhas (cross-tenant, a cada 60s).
CREATE INDEX IF NOT EXISTS "idx_campaigns_next_tick_running"
  ON "campaigns" ("next_tick_at") WHERE "status" = 'running';
--> statement-breakpoint

-- ─── (C) Heal do dado legado preso em `sending` (CAMP-03/04) ─────────────────

-- (C1) Recipients cujo ultimo step ja era o ultimo da campanha -> terminal.
UPDATE "campaign_recipients" r
   SET "status" = 'completed',
       "completed_at" = COALESCE(r."last_step_at", now()),
       "next_step_at" = NULL
 WHERE r."status" = 'sending'
   AND NOT EXISTS (
     SELECT 1 FROM "campaign_steps" s
      WHERE s."campaign_id" = r."campaign_id"
        AND s."position" = COALESCE(r."last_step_index", -1) + 1
   );
--> statement-breakpoint

-- (C2) Recipients com proximo step -> pending agendado pelo delay do proximo step.
UPDATE "campaign_recipients" r
   SET "status" = 'pending',
       "next_step_at" = COALESCE(r."last_step_at", now())
                        + (s."delay_seconds" * interval '1 second')
  FROM "campaign_steps" s
 WHERE r."status" = 'sending'
   AND s."campaign_id" = r."campaign_id"
   AND s."position" = COALESCE(r."last_step_index", -1) + 1;
--> statement-breakpoint

-- (C3) Recipients ja `completed` de outras origens sem carimbo -> backfill leve.
UPDATE "campaign_recipients"
   SET "completed_at" = COALESCE("last_step_at", "created_at")
 WHERE "status" = 'completed' AND "completed_at" IS NULL;
