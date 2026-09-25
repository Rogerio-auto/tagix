-- F70-S19 (achado M2 da auditoria pré-deploy) — marca "IA ligada por um humano".
--
-- A trava de origem (F70-S07/S08) impede os caminhos AUTOMÁTICOS de ligar a IA em conversa
-- sem origem comprovada, mas o worker de agentes respondia a QUALQUER conversa com
-- `ai_mode='on'`. Conversas que já estavam `on` antes da trava (legado, sem `origin`)
-- continuavam recebendo resposta automática — o caso que a F70 existe para impedir (o número
-- é pessoal: família e contatos antigos escrevem nele).
--
-- Agora o worker só responde se a origem for elegível OU se houver uma marca humana POSTERIOR
-- ao último `on` automático:
--   ai_enabled_at       — quando um humano ligou a IA (PATCH/POST das rotas de conversa);
--   ai_enabled_by       — quem ligou (membro; auditoria, pode virar NULL se o membro sair);
--   ai_auto_enabled_at  — quando a IA virou `on` SEM a marca humana no mesmo UPDATE. Gravada
--                         pelo trigger abaixo, então cobre todo caminho (flow, campanha,
--                         retomada, transferência, SQL manual), inclusive os que ainda não
--                         existem. Um `on` automático posterior invalida a marca humana antiga.
--
-- Aditiva: colunas nullable, sem default, sem reescrita de tabela. Sem backfill de propósito:
-- nada comprova que as conversas `on` legadas foram ligadas por um humano (fail-closed). Elas
-- param de receber IA até um humano religar — consulta de pré-deploy no slot F70-S19.
--
-- FK composta por workspace (padrão da 0085): o membro que ligou é do MESMO workspace da
-- conversa. `ON DELETE SET NULL (ai_enabled_by)` (PG >= 15) preserva `workspace_id` e mantém
-- `ai_enabled_at` (a marca continua valendo; só a autoria some). A validação da FK é um scan
-- de `conversations` com a coluna nova toda NULL (nenhuma consulta a `members`).
--
-- Reverter:
--   DROP TRIGGER IF EXISTS trg_conversations_ai_enable_mark ON conversations;
--   DROP FUNCTION IF EXISTS public.conversations_ai_enable_mark();
--   ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_workspace_ai_enabled_by_fk;
--   DROP INDEX IF EXISTS idx_conversations_ai_enabled_by;
--   ALTER TABLE conversations DROP COLUMN IF EXISTS ai_auto_enabled_at,
--     DROP COLUMN IF EXISTS ai_enabled_at, DROP COLUMN IF EXISTS ai_enabled_by;

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_enabled_by uuid,
  ADD COLUMN IF NOT EXISTS ai_enabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_auto_enabled_at timestamptz;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_workspace_ai_enabled_by_fk'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_workspace_ai_enabled_by_fk
      FOREIGN KEY (workspace_id, ai_enabled_by) REFERENCES members (workspace_id, id)
      ON DELETE SET NULL (ai_enabled_by);
  END IF;
END $$;
--> statement-breakpoint
-- Suporte à FK (exclusão de membro varre por igualdade); parcial: só quem ligou a IA à mão.
CREATE INDEX IF NOT EXISTS idx_conversations_ai_enabled_by
  ON conversations (ai_enabled_by) WHERE ai_enabled_by IS NOT NULL;
--> statement-breakpoint
-- Toda transição para `on` que NÃO grava uma marca humana nova no mesmo UPDATE é automática.
-- `clock_timestamp()` (não `now()`): o instante real da escrita, para a comparação com a marca
-- humana não depender de quando cada transação começou. As rotas humanas usam o mesmo relógio.
CREATE OR REPLACE FUNCTION public.conversations_ai_enable_mark() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.ai_mode = 'on'
     AND OLD.ai_mode IS DISTINCT FROM 'on'
     AND NEW.ai_enabled_at IS NOT DISTINCT FROM OLD.ai_enabled_at THEN
    NEW.ai_auto_enabled_at := clock_timestamp();
  END IF;
  RETURN NEW;
END
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_conversations_ai_enable_mark ON conversations;
--> statement-breakpoint
CREATE TRIGGER trg_conversations_ai_enable_mark
  BEFORE UPDATE OF ai_mode ON conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_ai_enable_mark();
--> statement-breakpoint
SET LOCAL lock_timeout TO DEFAULT;
