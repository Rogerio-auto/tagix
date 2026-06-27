-- F52-S01 — Schema foundation da sincronização de mensagens (LIVECHAT.md).
-- Adiciona à tabela `messages` as três colunas que destravam o endurecimento da
-- camada de mensagens. SÓ ESTRUTURA — nenhum backfill (outros slots escrevem valores).
-- A RLS já existente em `messages` cobre as novas colunas (privilégios são por tabela).
--   • media_status (enum)        — estado do pipeline de download de mídia inbound.
--   • provider_timestamp (tstz)  — horário autoritativo do provedor p/ ordenação fiel.
--   • outbound_idempotency_key   — dedup de envio (único parcial, espelha uq_messages_external).
-- Idempotente: CREATE TYPE com guarda + ADD COLUMN/CREATE INDEX IF NOT EXISTS →
-- reaplicar (migrate 2×) não falha.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'media_status') THEN
    CREATE TYPE "media_status" AS ENUM ('pending', 'downloading', 'ready', 'failed');
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "media_status" "media_status";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "provider_timestamp" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "outbound_idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_messages_outbound_idempotency_key" ON "messages" USING btree ("outbound_idempotency_key") WHERE "messages"."outbound_idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_conversation_provider_ts" ON "messages" USING btree ("conversation_id", coalesce("provider_timestamp", "created_at") desc);
