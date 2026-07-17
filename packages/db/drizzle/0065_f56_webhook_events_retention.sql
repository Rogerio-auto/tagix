-- F56-S25 (DB-02) — Retenção de webhook_events.
-- Ajusta o índice de `received_at` para o padrão de acesso do sweep de retenção:
-- varredura do MAIS ANTIGO abaixo do horizonte (`WHERE received_at < cutoff
-- ORDER BY received_at ASC LIMIT n`). O índice ascendente serve o range scan em
-- ordem direta, sem seq scan na tabela mais quente de escrita.
-- Antes: btree DESC NULLS LAST (0009). Agora: btree ASC.
DROP INDEX IF EXISTS "idx_webhook_events_received";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_events_received" ON "webhook_events" USING btree ("received_at");
