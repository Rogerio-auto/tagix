-- F47-S12 — Fecha a race de auto-criação de card (COCKPIT_CLIENT_ENRICHMENT).
-- Sem unique, duas requisições concorrentes de ensureDealForConversation criam 2
-- deals para a mesma conversa. Índice parcial: no máximo 1 deal por conversa
-- quando conversation_id NÃO é null (deals sem conversa coexistem livremente).
-- A API trata 23505 (unique_violation) re-selecionando o deal existente.

CREATE UNIQUE INDEX "uq_deals_conversation" ON "deals" ("conversation_id")
  WHERE "conversation_id" IS NOT NULL;
