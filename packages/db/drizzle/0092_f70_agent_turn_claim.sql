-- F70-S26 — turno da IA idempotente por envelope.
--
-- Os gatilhos da IA (`flow.run.requested`, `hm.q.flows`) saem pela outbox desde a F70-S25:
-- entrega pelo menos uma vez. O relay que cai entre publicar e marcar a linha republica o
-- mesmo envelope, e a ladder de retry reentrega o envelope de um turno que lançou. Sem
-- reivindicação, cada entrega rodava o turno de novo: duas chamadas ao runtime e duas
-- respostas ao cliente para a mesma mensagem.
--
-- O worker de agentes passa a reivindicar o turno pela chave estável do gatilho
-- (`agentRunTriggerId`, `@hm/shared/mq`) ANTES de chamar o runtime, na própria linha de
-- `agent_executions` que o runtime adota (`execution_id`, F70-S15):
--   trigger_id       — chave do fato que motivou o turno; única por workspace;
--   turn_state       — claimed → running → responded → completed | failed_before_runtime.
--                      Separado de `status`, que o runtime também escreve no `finalize`;
--   turn_token       — dono da reivindicação atual (toda transição confere);
--   turn_attempts    — reivindicações (1 + retentativas antes do runtime);
--   turn_claimed_at  — início da reivindicação (lease de `claimed`);
--   turn_reply       — resposta guardada entre o `final` do runtime e a gravação da mensagem.
--
-- Aditiva: colunas nullable sem default (sem reescrita). Linhas antigas ficam com as seis
-- NULL, o que os CHECKs aceitam. O índice único é parcial (`trigger_id IS N[OT] NULL`), então
-- nasce vazio; o build ainda lê a tabela uma vez sob o lock do ALTER, como os CHECKs. Tudo
-- na transação da migração (o migrator não aceita CONCURRENTLY): escritas em
-- `agent_executions` esperam o fim, que é o tempo de um scan da tabela.
--
-- Idempotente (IF NOT EXISTS / guarda em pg_constraint): reaplicar não falha.
--
-- Reverter:
--   DROP INDEX IF EXISTS uq_agent_executions_trigger;
--   ALTER TABLE agent_executions
--     DROP CONSTRAINT IF EXISTS agent_executions_turn_claim_chk,
--     DROP CONSTRAINT IF EXISTS agent_executions_turn_state_chk,
--     DROP COLUMN IF EXISTS turn_reply, DROP COLUMN IF EXISTS turn_claimed_at,
--     DROP COLUMN IF EXISTS turn_attempts, DROP COLUMN IF EXISTS turn_token,
--     DROP COLUMN IF EXISTS turn_state, DROP COLUMN IF EXISTS trigger_id;

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
ALTER TABLE agent_executions
  ADD COLUMN IF NOT EXISTS trigger_id text,
  ADD COLUMN IF NOT EXISTS turn_state text,
  ADD COLUMN IF NOT EXISTS turn_token uuid,
  ADD COLUMN IF NOT EXISTS turn_attempts integer,
  ADD COLUMN IF NOT EXISTS turn_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS turn_reply text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_executions_turn_state_chk'
  ) THEN
    ALTER TABLE agent_executions
      ADD CONSTRAINT agent_executions_turn_state_chk CHECK (
        turn_state IS NULL
        OR turn_state IN ('claimed', 'running', 'responded', 'completed', 'failed_before_runtime')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_executions_turn_claim_chk'
  ) THEN
    -- Chave e estado andam juntos; a chave tem o teto do contrato (AGENT_RUN_TRIGGER_ID_MAX).
    ALTER TABLE agent_executions
      ADD CONSTRAINT agent_executions_turn_claim_chk CHECK (
        (trigger_id IS NULL) = (turn_state IS NULL)
        AND (trigger_id IS NULL OR length(trigger_id) <= 256)
      );
  END IF;
END $$;
--> statement-breakpoint
-- A reivindicação: INSERT ... ON CONFLICT (workspace_id, trigger_id) WHERE trigger_id IS
-- NOT NULL. Também serve à leitura do estado de um gatilho repetido.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_executions_trigger
  ON agent_executions (workspace_id, trigger_id)
  WHERE trigger_id IS NOT NULL;
