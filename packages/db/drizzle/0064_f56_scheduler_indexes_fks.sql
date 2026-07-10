-- F56-S24 — Índices dos schedulers + FKs pendentes (AUDITORIA_TECNICA §3.8:
-- DB-03 / DB-05 / DB-06, ESC-04). Migration 100% idempotente: pode re-rodar em
-- qualquer ambiente sem efeito colateral (IF NOT EXISTS + guardas em pg_constraint).
--
-- (A) Índices que eliminam os seq scans dos schedulers cross-tenant:
--     DB-03  events(start_at) parcial status<>'cancelled'          → calendar-reminders
--     DB-05  agent_executions(workspace_id, started_at DESC)       → listagem por tenant
--            agent_executions(status) parcial running/interrupted  → sweeper de execuções vivas
--     ESC-04 conversations(workspace_id) parcial ai_mode='paused'  → cron de reengajamento
--
-- (B) DB-06 — FKs pendentes agora resolvíveis (`agents` existe desde a F2):
--     conversations.agent_id e messages.sender_agent_id ganham FK ON DELETE SET NULL.
--     conversations.department_id/team_id JÁ têm FK desde a 0033 (backfill F8) — o gap
--     era só o schema TS, corrigido em src/schema/conversations.ts; nada a fazer aqui.
--     Antes de cada FK: limpeza de órfãos (valores que apontam p/ agentes já apagados —
--     sem a constraint nada impedia), senão o ADD CONSTRAINT falha em dado legado.
--     + índices parciais de suporte às FKs (o ON DELETE SET NULL de um agente varre as
--     tabelas referenciantes por igualdade; sem índice seria seq scan em messages).
--
-- NOTA (CONCURRENTLY): o runner do repo (drizzle-orm/postgres-js/migrator, via
-- src/migrate.ts) aplica as migrations dentro de UMA transação → CREATE INDEX
-- CONCURRENTLY é impossível aqui (25001 invalid_transaction_state). Trade-off aceito:
-- CREATE INDEX plano segura SHARE lock (bloqueia writes na tabela durante o build).
-- Para deploy zero-downtime em prod, ops pode pré-criar os índices à mão com
-- CONCURRENTLY (mesmos nomes) ANTES do deploy — como tudo abaixo é idempotente,
-- a migration vira no-op.

-- ─── (A) Índices dos schedulers ───────────────────────────────────────────────

-- DB-03: calendar-reminders varre CROSS-TENANT por janela de start_at a cada tick.
CREATE INDEX IF NOT EXISTS "idx_events_start_active"
  ON "events" ("start_at") WHERE "status" <> 'cancelled';
--> statement-breakpoint

-- DB-05: eixo por tenant (recência primeiro) — antes só existia o eixo por agente.
CREATE INDEX IF NOT EXISTS "idx_agent_executions_ws_started"
  ON "agent_executions" ("workspace_id", "started_at" DESC);
--> statement-breakpoint

-- DB-05: sweeper de execuções vivas — parcial só nos estados ativos.
CREATE INDEX IF NOT EXISTS "idx_agent_executions_status_active"
  ON "agent_executions" ("status") WHERE "status" IN ('running', 'interrupted');
--> statement-breakpoint

-- ESC-04: reengagement scheduler varre conversas com IA pausada.
CREATE INDEX IF NOT EXISTS "idx_conversations_ws_ai_paused"
  ON "conversations" ("workspace_id") WHERE "ai_mode" = 'paused';
--> statement-breakpoint

-- ─── (B) DB-06 — FKs pendentes p/ agents ─────────────────────────────────────

-- Órfãos: agent_id apontando p/ agente que já foi apagado (pré-FK). SET NULL espelha
-- exatamente a semântica ON DELETE da constraint que entra a seguir.
UPDATE "conversations" c
   SET "agent_id" = NULL
 WHERE c."agent_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "agents" a WHERE a."id" = c."agent_id");
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_agent_id_agents_id_fk'
  ) THEN
    ALTER TABLE "conversations"
      ADD CONSTRAINT "conversations_agent_id_agents_id_fk"
      FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

UPDATE "messages" m
   SET "sender_agent_id" = NULL
 WHERE m."sender_agent_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "agents" a WHERE a."id" = m."sender_agent_id");
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_sender_agent_id_agents_id_fk'
  ) THEN
    ALTER TABLE "messages"
      ADD CONSTRAINT "messages_sender_agent_id_agents_id_fk"
      FOREIGN KEY ("sender_agent_id") REFERENCES "public"."agents"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
--> statement-breakpoint

-- Índices de suporte às FKs (parcial NOT NULL — espelha idx_conversations_department/
-- team da 0033). Sem eles, DELETE em agents faria seq scan nas referenciantes.
CREATE INDEX IF NOT EXISTS "idx_conversations_agent"
  ON "conversations" ("agent_id") WHERE "agent_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_sender_agent"
  ON "messages" ("sender_agent_id") WHERE "sender_agent_id" IS NOT NULL;
