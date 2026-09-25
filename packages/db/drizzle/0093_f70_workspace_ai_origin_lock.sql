-- F70-S30 — trava de origem da IA como configuração do workspace.
--
-- A trava (F70-S07/S08/S19/S23) valia para todo workspace: a IA automática só atende conversa
-- com origem comprovada (anúncio, site, Instagram) ou ligada por um humano. Ela protege o
-- número pessoal (família e contatos antigos não recebem IA) e atrapalha o número só
-- comercial, que quer IA em todo lead. Cada workspace passa a decidir.
--
--   ai_requires_proven_origin — true: regra atual; false: a origem deixa de importar.
--
-- NOT NULL DEFAULT true: todo workspace, existente ou novo, nasce travado (fail-closed); só um
-- OWNER/ADMIN desliga, pela rota auditada. Os predicados de `@hm/flow-engine`
-- (`ai-origin-gate.ts`) leem a coluna por subselect DENTRO do UPDATE que liga a IA, então não
-- há janela entre ler a configuração e ligar. Leitura por PK de `workspaces`: sem índice novo.
--
-- Aditiva e barata: desde o PG 11 um ADD COLUMN com DEFAULT constante não reescreve a tabela.
-- Idempotente (IF NOT EXISTS).
--
-- Reverter:
--   ALTER TABLE workspaces DROP COLUMN IF EXISTS ai_requires_proven_origin;
--   (o código anterior ignora a coluna; a trava volta a valer para todos)

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS ai_requires_proven_origin boolean NOT NULL DEFAULT true;
--> statement-breakpoint
COMMENT ON COLUMN workspaces.ai_requires_proven_origin IS
  'F70-S30: true = IA automática só com origem comprovada ou marca humana; false = qualquer conversa. Muda só por OWNER/ADMIN (audit_logs workspace.ai_origin_lock.update).';
