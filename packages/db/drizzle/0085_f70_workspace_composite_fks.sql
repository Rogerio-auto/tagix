-- F70-S12 — FKs compostas por workspace em deals e stages (defesa em profundidade da F70-S11).
--
-- A checagem de FK do Postgres roda FORA da RLS: `deals.stage_id REFERENCES stages(id)` aceita
-- o id de uma etapa de QUALQUER workspace. Com a FK composta
-- `(workspace_id, stage_id) REFERENCES stages (workspace_id, id)` o próprio banco exige que o
-- alvo pertença ao mesmo workspace da linha, mesmo que um handler esqueça de validar. Mesmo
-- padrão de `uq_channels_workspace_id` + FK composta da 0067.
--
-- Ações de exclusão preservadas 1:1:
--   stages.pipeline_id       CASCADE
--   deals.pipeline_id        CASCADE
--   deals.stage_id           RESTRICT
--   deals.contact_id         CASCADE
--   deals.conversation_id    SET NULL (conversation_id)   -- PG >= 15 (prod: pg16, dev: 16.15)
--   deals.owner_id           SET NULL (owner_id)          -- idem
-- Nas anuláveis o SET NULL precisa da lista de colunas: sem ela o Postgres anularia TAMBÉM
-- `workspace_id` (NOT NULL) e a exclusão da conversa/membro falharia com 23502.
-- MATCH SIMPLE (padrão): referência NULL não é checada, então deal sem conversa/dono segue válido.
--
-- `uq_deals_conversation` passa a (workspace_id, conversation_id), parcial como antes.
--
-- Pré-voo: aborta com RAISE EXCEPTION (contagem por coluna) se existir QUALQUER referência
-- cruzada. Nunca apaga nem anula dado em silêncio — a limpeza é decisão humana.
--
-- Locks: tudo roda na transação do migrator. Os LOCKs explícitos pegam as 6 tabelas numa ordem
-- fixa antes do pré-voo (o resultado dele não pode ficar velho até o ADD CONSTRAINT) e o
-- lock_timeout faz a migração falhar rápido em vez de enfileirar o tráfego atrás dela.
-- Escritas nessas tabelas ficam bloqueadas até o COMMIT (índices sem CONCURRENTLY, que não
-- roda em transação). Reverter: ver "Como reverter" em tasks/slots/F70/F70-S12-*.md.

SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
LOCK TABLE pipelines, stages, members, contacts, conversations, deals IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint

-- ─── Pré-voo ────────────────────────────────────────────────────────────────────
DO $preflight$
DECLARE
  can_see_all boolean;
  n_stages_pipeline bigint;
  n_deals_pipeline bigint;
  n_deals_stage bigint;
  n_deals_contact bigint;
  n_deals_conversation bigint;
  n_deals_owner bigint;
  total bigint;
BEGIN
  -- As tabelas têm FORCE RLS: um papel sem BYPASSRLS contaria zero e o pré-voo passaria em
  -- falso. Exige um papel que enxergue todas as linhas.
  SELECT r.rolsuper OR r.rolbypassrls INTO can_see_all FROM pg_roles r WHERE r.rolname = current_user;
  IF NOT coalesce(can_see_all, false) THEN
    RAISE EXCEPTION 'F70-S12: o pré-voo precisa de papel com BYPASSRLS ou superuser (current_user=%)', current_user;
  END IF;

  SELECT count(*) INTO n_stages_pipeline
    FROM stages s JOIN pipelines p ON p.id = s.pipeline_id
   WHERE p.workspace_id <> s.workspace_id;
  SELECT count(*) INTO n_deals_pipeline
    FROM deals d JOIN pipelines p ON p.id = d.pipeline_id
   WHERE p.workspace_id <> d.workspace_id;
  SELECT count(*) INTO n_deals_stage
    FROM deals d JOIN stages s ON s.id = d.stage_id
   WHERE s.workspace_id <> d.workspace_id;
  SELECT count(*) INTO n_deals_contact
    FROM deals d JOIN contacts c ON c.id = d.contact_id
   WHERE c.workspace_id <> d.workspace_id;
  SELECT count(*) INTO n_deals_conversation
    FROM deals d JOIN conversations c ON c.id = d.conversation_id
   WHERE c.workspace_id <> d.workspace_id;
  SELECT count(*) INTO n_deals_owner
    FROM deals d JOIN members m ON m.id = d.owner_id
   WHERE m.workspace_id <> d.workspace_id;

  total := n_stages_pipeline + n_deals_pipeline + n_deals_stage + n_deals_contact
         + n_deals_conversation + n_deals_owner;
  IF total > 0 THEN
    RAISE EXCEPTION 'F70-S12: % referência(s) cruzada(s) entre workspaces; nada foi alterado', total
      USING DETAIL = format(
        'stages.pipeline_id=%s deals.pipeline_id=%s deals.stage_id=%s deals.contact_id=%s deals.conversation_id=%s deals.owner_id=%s',
        n_stages_pipeline, n_deals_pipeline, n_deals_stage, n_deals_contact,
        n_deals_conversation, n_deals_owner),
      HINT = 'Corrija as linhas (JOIN pela coluna citada comparando workspace_id) e rode a migração de novo.';
  END IF;
END $preflight$;
--> statement-breakpoint

-- ─── Chaves (workspace_id, id) nas tabelas-alvo ─────────────────────────────────
-- Nenhuma delas tinha unique equivalente (só a PK em id). Uma FK composta só aponta para
-- colunas com unique não-parcial.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pipelines_workspace_id ON pipelines (workspace_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_stages_workspace_id ON stages (workspace_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_members_workspace_id ON members (workspace_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_workspace_id ON contacts (workspace_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_workspace_id ON conversations (workspace_id, id);
--> statement-breakpoint

-- ─── FKs compostas (troca atômica por tabela) ───────────────────────────────────
ALTER TABLE stages
  DROP CONSTRAINT IF EXISTS stages_pipeline_id_pipelines_id_fk,
  DROP CONSTRAINT IF EXISTS stages_workspace_pipeline_fk,
  ADD CONSTRAINT stages_workspace_pipeline_fk
    FOREIGN KEY (workspace_id, pipeline_id) REFERENCES pipelines (workspace_id, id)
    ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE deals
  DROP CONSTRAINT IF EXISTS deals_pipeline_id_pipelines_id_fk,
  DROP CONSTRAINT IF EXISTS deals_stage_id_stages_id_fk,
  DROP CONSTRAINT IF EXISTS deals_contact_id_contacts_id_fk,
  DROP CONSTRAINT IF EXISTS deals_conversation_id_conversations_id_fk,
  DROP CONSTRAINT IF EXISTS deals_owner_id_members_id_fk,
  DROP CONSTRAINT IF EXISTS deals_workspace_pipeline_fk,
  DROP CONSTRAINT IF EXISTS deals_workspace_stage_fk,
  DROP CONSTRAINT IF EXISTS deals_workspace_contact_fk,
  DROP CONSTRAINT IF EXISTS deals_workspace_conversation_fk,
  DROP CONSTRAINT IF EXISTS deals_workspace_owner_fk,
  ADD CONSTRAINT deals_workspace_pipeline_fk
    FOREIGN KEY (workspace_id, pipeline_id) REFERENCES pipelines (workspace_id, id)
    ON DELETE CASCADE,
  ADD CONSTRAINT deals_workspace_stage_fk
    FOREIGN KEY (workspace_id, stage_id) REFERENCES stages (workspace_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT deals_workspace_contact_fk
    FOREIGN KEY (workspace_id, contact_id) REFERENCES contacts (workspace_id, id)
    ON DELETE CASCADE,
  ADD CONSTRAINT deals_workspace_conversation_fk
    FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversations (workspace_id, id)
    ON DELETE SET NULL (conversation_id),
  ADD CONSTRAINT deals_workspace_owner_fk
    FOREIGN KEY (workspace_id, owner_id) REFERENCES members (workspace_id, id)
    ON DELETE SET NULL (owner_id);
--> statement-breakpoint

-- ─── uq_deals_conversation por workspace ────────────────────────────────────────
-- ATENÇÃO: ON CONFLICT (conversation_id) WHERE conversation_id IS NOT NULL deixa de achar
-- índice (42P10). Os chamadores passam a usar o alvo (workspace_id, conversation_id).
DROP INDEX IF EXISTS uq_deals_conversation;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_deals_conversation ON deals (workspace_id, conversation_id)
  WHERE conversation_id IS NOT NULL;
--> statement-breakpoint

SET LOCAL lock_timeout TO DEFAULT;
