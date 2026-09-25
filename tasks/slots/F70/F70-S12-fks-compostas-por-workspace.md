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

- [ ] migração aplicada no dev; INSERT com referência cruzada falha com 23503 (teste)
- [ ] ações de exclusão preservadas (teste por FK)
- [ ] migração reversível documentada
