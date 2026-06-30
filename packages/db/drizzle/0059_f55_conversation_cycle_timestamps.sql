-- F55-S01 — Timestamps de ciclo de atendimento em `conversations` (LIVECHAT.md / métricas).
-- Três colunas timestamptz NULLABLE, sem default: NULL = o marco ainda NÃO ocorreu.
--   • first_response_at — 1ª resposta humana (msg outbound de um member) → base do SLA de 1ª resposta.
--   • resolved_at       — instante em que a conversa foi marcada como resolvida.
--   • closed_at         — instante em que a conversa foi fechada.
-- `conversations` já tem RLS habilitada → as colunas herdam o isolamento por workspace;
-- NENHUMA policy nova.
-- Índices parciais (só linhas com o marco) e escopados por workspace_id, pois toda consulta
-- de métrica filtra por workspace; DESC p/ servir "mais recentes" sem sort.
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS + backfill guardado por
-- "IS NULL" → reaplicar (migrate 2×) não falha nem sobrescreve valores já gravados.

ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "first_response_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_ws_resolved_at" ON "conversations" USING btree ("workspace_id","resolved_at" desc) WHERE "resolved_at" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_ws_first_response_at" ON "conversations" USING btree ("workspace_id","first_response_at" desc) WHERE "first_response_at" is not null;--> statement-breakpoint

-- Backfill best-effort (idempotente; só toca linhas ainda NULL).
-- first_response_at: horário da 1ª mensagem outbound de um MEMBRO humano, por conversa.
-- Conversas atendidas só por agente/sistema permanecem NULL (não houve resposta humana).
UPDATE "conversations" c
SET "first_response_at" = fr.first_at
FROM (
  SELECT "conversation_id", MIN("created_at") AS first_at
  FROM "messages"
  WHERE "direction" = 'outbound' AND "sender_type" = 'member'
  GROUP BY "conversation_id"
) fr
WHERE fr."conversation_id" = c."id" AND c."first_response_at" IS NULL;--> statement-breakpoint

-- resolved_at: PROXY histórico. A plataforma não registrava o instante exato da transição,
-- então usamos MAX(messages.created_at) (última atividade) como APROXIMAÇÃO, SOMENTE para
-- conversas já em status='resolved' e ainda sem timestamp. Daqui pra frente a app grava o
-- valor exato; este backfill cobre apenas o legado.
UPDATE "conversations" c
SET "resolved_at" = lm.last_at
FROM (
  SELECT "conversation_id", MAX("created_at") AS last_at
  FROM "messages"
  GROUP BY "conversation_id"
) lm
WHERE lm."conversation_id" = c."id" AND c."status" = 'resolved' AND c."resolved_at" IS NULL;--> statement-breakpoint

-- closed_at: mesmo PROXY histórico (MAX(messages.created_at)) SOMENTE para conversas já em
-- status='closed' e ainda sem timestamp. Aproximação para o histórico.
UPDATE "conversations" c
SET "closed_at" = lm.last_at
FROM (
  SELECT "conversation_id", MAX("created_at") AS last_at
  FROM "messages"
  GROUP BY "conversation_id"
) lm
WHERE lm."conversation_id" = c."id" AND c."status" = 'closed' AND c."closed_at" IS NULL;
