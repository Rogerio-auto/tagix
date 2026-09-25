-- F70-S07 — origem da conversa (trava da IA).
--
-- O número do dono é pessoal: família e contatos antigos escrevem no mesmo WhatsApp que recebe
-- os anúncios. A IA só pode ser ligada AUTOMATICAMENTE (flow `ai_action`, handoff de campanha)
-- em conversa com origem comprovada. A origem é classificada uma vez, na criação da conversa,
-- pelo worker (`classifyConversationOrigin`, @hm/channels) e gravada aqui.
--
-- Aditiva: coluna nullable, sem default, sem reescrita de tabela. Conversas existentes ficam
-- NULL, que a aplicação lê como `sem-origem` (fail-closed) — sem backfill de propósito: nada
-- comprova de onde vieram. CHECK via DO $$ (idempotente, padrão da 0081/0082). Sem índice: a
-- trava consulta pela PK. RLS: `conversations` já tem policy por workspace_id.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS origin text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_origin_chk') THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_origin_chk
      CHECK (origin IS NULL OR origin IN ('origem:anuncio','origem:site','origem:instagram','origem:prospeccao','sem-origem'));
  END IF;
END $$;
