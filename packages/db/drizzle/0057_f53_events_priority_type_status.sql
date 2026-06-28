-- F53-S01 — Agenda Inteligente: estende `events` p/ compromissos comerciais.
-- Sem tabela nova — `events` e a fonte unica de compromissos. Tudo retrocompativel:
--   • priority (text, default 'medium') — linhas legadas ganham prioridade media sem backfill.
--   • events_type_chk   — recriada incluindo call/whatsapp/billing/proposal/custom (mantem os 6 atuais).
--   • events_status_chk — recriada incluindo in_progress/postponed (mantem os 4 atuais).
-- `events` ja tem RLS habilitada (0030/0031) -> nenhuma policy nova; as colunas/checks
-- herdam o isolamento por workspace existente.
-- Idempotente: ADD COLUMN IF NOT EXISTS + DROP CONSTRAINT IF EXISTS antes do ADD ->
-- reaplicar (migrate 2x) nao falha.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_priority_chk";--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_priority_chk" CHECK ("events"."priority" in ('low','medium','high'));--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_type_chk";--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_type_chk" CHECK ("events"."type" in ('meeting','demo','follow_up','task','reminder','other','call','whatsapp','billing','proposal','custom'));--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_status_chk";--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_status_chk" CHECK ("events"."status" in ('scheduled','confirmed','cancelled','completed','in_progress','postponed'));
