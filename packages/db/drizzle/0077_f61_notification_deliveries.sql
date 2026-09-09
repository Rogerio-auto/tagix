-- F61-S04 — memória de entregas de notificação (APP_MOBILE_PLAN §4.2).
--
-- Duas funções, e a segunda é a que justifica a tabela:
--
-- 1. **Dedupe estrutural.** Um evento não pode gerar dois avisos. O índice único
--    em (workspace, member, event_key, channel) faz a segunda tentativa falhar no
--    banco, não numa checagem que alguém pode esquecer de chamar — e retry de
--    fila é comum, não exceção.
--
-- 2. **Responder "por que não fui avisado?".** Sem registro, essa pergunta não tem
--    resposta, e a primeira vez que o dono a fizer sem obter resposta ele para de
--    confiar no aviso — e passa a conferir o app "por garantia", que é
--    exatamente o trabalho que o produto deveria ter tirado dele.
--
-- Por isso `status` guarda também o que NÃO saiu, com o motivo.

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  -- Identidade do FATO notificado (ex.: "lead_novo:<conversation_id>"). É o que
  -- torna o dedupe possível: dois disparos do mesmo fato compartilham a chave.
  event_key text NOT NULL,
  channel text NOT NULL,
  status text NOT NULL,
  -- Preenchido quando status='suprimido': preferencia | silencio | ja_avisado |
  -- ja_viu. É a resposta ao "por que não fui avisado?".
  suppressed_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Dedupe estrutural. Sem isto o "não avise duas vezes" seria uma consulta que
-- corre contra outro consumidor da mesma fila.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_deliveries_evento
  ON notification_deliveries (workspace_id, member_id, event_key, channel);
--> statement-breakpoint

-- Faxina por idade e leitura do histórico recente de um membro.
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_member_time
  ON notification_deliveries (workspace_id, member_id, created_at DESC);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_deliveries_status_chk') THEN
    ALTER TABLE notification_deliveries
      ADD CONSTRAINT notification_deliveries_status_chk
      CHECK (status IN ('enviado','falhou','suprimido'));
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS notification_deliveries_isolation ON notification_deliveries;
--> statement-breakpoint
CREATE POLICY notification_deliveries_isolation ON notification_deliveries
  USING (workspace_id = app_current_workspace())
  WITH CHECK (workspace_id = app_current_workspace());
--> statement-breakpoint

-- Fuso do MEMBRO. A janela de silêncio é calculada no relógio de quem recebe, não
-- no do servidor nem no do workspace: o cliente brasileiro nos EUA tem equipe nos
-- dois fusos. NULO = usar o default do market pack do workspace.
--
-- Sem CHECK de propósito: a lista IANA muda com o tempo e um CHECK engessa a
-- migration (mesma decisão da 0069 para `contacts.timezone`).
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS timezone text;
