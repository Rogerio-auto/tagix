-- F59-S02 — mercado no workspace e fuso no contato (AGENCIA_PLAN.md §3.2, §4.1).
--
-- Nos EUA a janela horária legal de envio é calculada no fuso do DESTINATÁRIO, não
-- no da campanha. Hoje o fuso vive em `campaigns.timezone` com default
-- 'America/Sao_Paulo', o que quebra silenciosamente com contatos na Flórida e na
-- Califórnia na mesma base — a mensagem sai dentro da janela de São Paulo e fora
-- da janela de quem recebe.
--
-- `market` default 'BR' preserva o comportamento de todo workspace existente:
-- o market pack BR não exige consentimento prévio em canais já em uso nem impõe
-- janela horária, então nada muda para quem já opera.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS market text NOT NULL DEFAULT 'BR';
--> statement-breakpoint

-- Constraint separada do ADD COLUMN para ser idempotente em base já migrada.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_market_chk'
  ) THEN
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_market_chk CHECK (market IN ('BR','US'));
  END IF;
END $$;
--> statement-breakpoint

-- Conjunto de idiomas habilitados no workspace. NULO significa "usar os locales do
-- market pack" (BR: pt-BR · US: en-US + pt-BR) — evita duplicar o dado e evita que
-- a coluna derive do pack com o tempo. Só é preenchida quando o cliente restringe
-- (ex.: empresa nos EUA que atende só em inglês).
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS locales jsonb;
--> statement-breakpoint

-- Fuso do contato. NULO = usar o `defaultTimezone` do market pack do workspace.
-- Sem CHECK de propósito: a lista IANA muda com o tempo e um CHECK engessa a
-- migration. A validação é Zod, na borda (ver DoD do slot).
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS timezone text;
--> statement-breakpoint

-- Parcial: o agendador varre só quem tem fuso próprio para agrupar por janela.
-- Contato sem fuso resolve pelo pack e não precisa entrar no índice.
CREATE INDEX IF NOT EXISTS idx_contacts_workspace_timezone
  ON contacts (workspace_id, timezone)
  WHERE timezone IS NOT NULL AND deleted_at IS NULL;
