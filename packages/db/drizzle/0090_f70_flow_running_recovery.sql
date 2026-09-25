-- F70-S25 — recuperação de execução de flow `running` parada.
--
-- O scheduler de flows (`apps/workers/src/flows/scheduler.ts`) passa a reanimar, a cada
-- tick, a execução que está `running` há mais que o limite sem ninguém a reivindicar
-- (o passo dela se perdeu). A varredura é cross-tenant e roda a cada minuto; sem índice
-- seria um seq scan de `flow_executions`, que só cresce (as terminais ficam).
--
-- O índice é parcial em `status = 'running'` — o estado transitório entre um passo e o
-- seguinte, então fica pequeno — e ordena pelo mesmo relógio que a varredura usa:
-- `coalesce(updated_at, started_at)` (a execução recém-criada ainda não tem `updated_at`).
--
-- Criado dentro da transação da migração (o migrator do Drizzle não aceita CONCURRENTLY).
-- O build lê a tabela inteira uma vez sob SHARE lock: escritas em `flow_executions`
-- esperam o fim do build.
--
-- Reverter:
--   DROP INDEX IF EXISTS idx_flow_executions_running_since;

CREATE INDEX IF NOT EXISTS idx_flow_executions_running_since
  ON flow_executions ((coalesce(updated_at, started_at)))
  WHERE status = 'running';
