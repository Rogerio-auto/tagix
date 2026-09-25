---
id: F70-S12
title: FKs compostas por workspace nas referências de deals e stages
phase: F70
status: in-progress
priority: high
estimated_size: M
depends_on: [F70-S10, F70-S11]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S11-referencias-cruzadas-entre-workspaces.md
agent_id: backend-engineer
claimed_at: 2026-09-25T04:46:30Z

---
# F70-S12 — FKs compostas por workspace nas referências de deals e stages

## Objetivo

O banco recusar referência cruzada entre workspaces mesmo que um handler esqueça de validar (defesa em profundidade da F70-S11).

## Contexto

Hoje só `channels` usa o padrão `uq_channels_workspace_id` + FK composta (`0067`). `deals` e `stages` referenciam por `id` sozinho, e a checagem de FK ignora a RLS.

## Escopo

### files_allowed

- `packages/db/drizzle/**`
- `packages/db/src/schema/pipeline.ts`
- `packages/db/src/schema/contacts.ts`
- `packages/db/src/schema/conversations.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/*.test.ts`

## Escopo (faz)

- Pré-voo na migração: detectar linhas com referência cruzada; abortar com mensagem clara (produção hoje tem um único workspace, então não deve haver nenhuma).
- `uq_<t>_workspace_id (workspace_id, id)` em `contacts`, `conversations`, `pipelines`, `stages`, `members`.
- FKs compostas em `deals` (`pipeline_id`, `stage_id`, `contact_id`, `conversation_id`, `owner_id`) e `stages.pipeline_id`, preservando as ações atuais; nas anuláveis, `ON DELETE SET NULL (coluna)` (PG ≥ 15; conferir a versão do Postgres de produção no compose).
- `uq_deals_conversation` passa a `(workspace_id, conversation_id)`.

## Fora de escopo

- `conversion_events`, `events`, `contact_tags`, `kb_feedback` (slot seguinte, mesmo padrão).

## Definition of Done

- [x] migração aplicada no dev; INSERT com referência cruzada falha com 23503 (teste)
- [x] ações de exclusão preservadas (teste por FK)
- [x] migração reversível documentada

## Implementação

Migração `packages/db/drizzle/0085_f70_workspace_composite_fks.sql` (SQL à mão + journal).

- Postgres: produção `pgvector/pgvector:pg16` (`infra/docker/docker-compose.prod.yml`), dev 16.15.
  Por isso as anuláveis usam `ON DELETE SET NULL (coluna)` nativo (PG ≥ 15), sem trigger. Sem a
  lista de colunas o Postgres anularia também `workspace_id` (NOT NULL) e a exclusão falharia.
- Ordem: `SET LOCAL lock_timeout = '10s'` → `LOCK TABLE` das 6 tabelas (ordem fixa) → pré-voo
  (`RAISE EXCEPTION` com contagem por coluna no DETAIL; exige papel superuser/BYPASSRLS, porque com
  FORCE RLS um papel comum contaria zero) → `uq_<t>_workspace_id` → troca das FKs → novo
  `uq_deals_conversation` → `lock_timeout` volta ao padrão.
- `uq_<t>_workspace_id (workspace_id, id)` em `pipelines`, `stages`, `members`, `contacts`,
  `conversations`. Nenhuma tinha equivalente: só a PK em `id`.

| FK nova | Colunas → alvo | ON DELETE | FK simples removida |
| --- | --- | --- | --- |
| `stages_workspace_pipeline_fk` | `(workspace_id, pipeline_id)` → `pipelines` | CASCADE | `stages_pipeline_id_pipelines_id_fk` |
| `deals_workspace_pipeline_fk` | `(workspace_id, pipeline_id)` → `pipelines` | CASCADE | `deals_pipeline_id_pipelines_id_fk` |
| `deals_workspace_stage_fk` | `(workspace_id, stage_id)` → `stages` | RESTRICT | `deals_stage_id_stages_id_fk` |
| `deals_workspace_contact_fk` | `(workspace_id, contact_id)` → `contacts` | CASCADE | `deals_contact_id_contacts_id_fk` |
| `deals_workspace_conversation_fk` | `(workspace_id, conversation_id)` → `conversations` | SET NULL (conversation_id) | `deals_conversation_id_conversations_id_fk` |
| `deals_workspace_owner_fk` | `(workspace_id, owner_id)` → `members` | SET NULL (owner_id) | `deals_owner_id_members_id_fk` |

Schema Drizzle: as colunas perderam `.references()` e as FKs viraram `foreignKey({ name, columns,
foreignColumns })` no bloco de constraints. O Drizzle não expressa `SET NULL (coluna)`, então o
schema declara `set null` e a migração é a fonte da verdade (comentado em `pipeline.ts`).

## Como reverter

Não há migração de down no repo. Para voltar ao estado da 0084, rode numa transação como
owner/superuser:

```sql
BEGIN;
SET LOCAL lock_timeout = '10s';
DROP INDEX IF EXISTS uq_deals_conversation;
CREATE UNIQUE INDEX uq_deals_conversation ON deals (conversation_id) WHERE conversation_id IS NOT NULL;
ALTER TABLE deals
  DROP CONSTRAINT IF EXISTS deals_workspace_pipeline_fk,
  DROP CONSTRAINT IF EXISTS deals_workspace_stage_fk,
  DROP CONSTRAINT IF EXISTS deals_workspace_contact_fk,
  DROP CONSTRAINT IF EXISTS deals_workspace_conversation_fk,
  DROP CONSTRAINT IF EXISTS deals_workspace_owner_fk,
  ADD CONSTRAINT deals_pipeline_id_pipelines_id_fk FOREIGN KEY (pipeline_id) REFERENCES pipelines (id) ON DELETE CASCADE,
  ADD CONSTRAINT deals_stage_id_stages_id_fk FOREIGN KEY (stage_id) REFERENCES stages (id) ON DELETE RESTRICT,
  ADD CONSTRAINT deals_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  ADD CONSTRAINT deals_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE SET NULL,
  ADD CONSTRAINT deals_owner_id_members_id_fk FOREIGN KEY (owner_id) REFERENCES members (id) ON DELETE SET NULL;
ALTER TABLE stages
  DROP CONSTRAINT IF EXISTS stages_workspace_pipeline_fk,
  ADD CONSTRAINT stages_pipeline_id_pipelines_id_fk FOREIGN KEY (pipeline_id) REFERENCES pipelines (id) ON DELETE CASCADE;
DROP INDEX IF EXISTS uq_pipelines_workspace_id, uq_stages_workspace_id, uq_members_workspace_id,
  uq_contacts_workspace_id, uq_conversations_workspace_id;
-- created_at = "when" da 0085 no journal; sem isto o migrator não a reaplicaria.
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1781452846000;
COMMIT;
```

Depois reverta o commit do schema e os alvos de `ON CONFLICT` (ver abaixo). O índice de
`uq_deals_conversation` e o alvo do `ON CONFLICT` nos chamadores precisam voltar juntos.

## Pendências fora da fronteira

`ON CONFLICT (conversation_id) WHERE conversation_id IS NOT NULL` não casa mais com
`uq_deals_conversation (workspace_id, conversation_id)`: o Postgres responde **42P10** ("there is no
unique or exclusion constraint matching the ON CONFLICT specification"). O teste
`workspace-composite-fks.test.ts` prova a quebra. Dois chamadores precisam trocar o alvo, **no mesmo
deploy da 0085**:

- `apps/api/src/routes/pipeline/deal-conversation.ts:214-217` (`ensureDealForConversation`);
- `apps/workers/src/leadgen/db-store.ts:437-440` (deal de lead ads).

Correção idêntica nos dois:

```ts
.onConflictDoNothing({
  target: [deals.workspaceId, deals.conversationId],
  where: sql`${deals.conversationId} is not null`,
})
```

Os re-SELECTs por `conversationId` sozinho (deal-conversation.ts:124/225, leadgen/db-store.ts:383,
conversations/index.ts:218) seguem corretos, porque `conversations.id` é globalmente único.

Observação: com a FK composta da conversa, unicidade global de `conversation_id` e unicidade por
`(workspace_id, conversation_id)` são equivalentes (a conversa pertence a um só workspace). A troca
do índice pedida no escopo não fecha nenhum buraco a mais. Se o deploy conjunto for um problema,
manter o índice antigo é seguro.

Fora da F70-S12: `deals.stage_id` não é amarrado a `deals.pipeline_id` (etapa de outro pipeline do
mesmo workspace). Isso pediria `uq_stages_pipeline_id (pipeline_id, id)` + FK
`(pipeline_id, stage_id)`.

## Validação

Executado em 25/09 contra o Postgres dev (`localhost:5442`, PG 16.15), com a 0085 aplicada
(`tsx src/migrate.ts`).

- `workspace-composite-fks.test.ts`: 38/38.
  - Schema × migração: 6 FKs, 5 índices, `uq_deals_conversation` e journal.
  - Catálogo real: `pg_get_constraintdef` e `pg_indexes` idênticos ao esperado, sem FK simples antiga.
  - 23503 no INSERT e no UPDATE, para cada uma das 5 colunas de `deals`, e em `stages.pipeline_id`.
    Também sob `hm_app` + RLS.
  - Uma exclusão por FK: SET NULL só na coluna, com `workspace_id` intacto; RESTRICT na etapa;
    CASCADE no contato e no pipeline.
  - Caminho feliz: deal criado e movido de etapa via `withWorkspace`. ON CONFLICT com o alvo novo
    é idempotente; o alvo antigo dá 42P10.
  - Pré-voo: a transação simula o dado legado (FK removida, deal cruzado), roda o DO do próprio
    arquivo da migração e recebe `P0001` com `deals.contact_id=1` no DETAIL. Depois do rollback, a
    FK continua de pé. Contra o estado atual, o pré-voo passa limpo.
- SQL de "Como reverter" ensaiado no dev dentro de `BEGIN … ROLLBACK`: as 8 FKs voltaram aos
  nomes da 0084 e o journal perdeu 1 linha.
- Regressão: `schema/ad-attribution.test.ts` (schema × 0082 de `deals`) 9/9, `rls.test.ts` 57/57.

```bash
python scripts/slot.py check-migrations
pnpm --filter @hm/db typecheck
pnpm --filter @hm/db exec vitest run src/workspace-composite-fks.test.ts src/schema/ad-attribution.test.ts src/rls.test.ts --maxWorkers=2
pnpm exec eslint packages/db/src/workspace-composite-fks.test.ts packages/db/src/schema/pipeline.ts packages/db/src/schema/contacts.ts packages/db/src/schema/conversations.ts packages/db/src/schema/index.ts
```
