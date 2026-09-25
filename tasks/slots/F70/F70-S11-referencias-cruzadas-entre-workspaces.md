---
id: F70-S11
title: Bloquear referências cruzadas entre workspaces nas rotas de escrita
phase: F70
status: in-progress
priority: critical
estimated_size: M
depends_on: [F70-S08]
blocks: [F70-S12]
source_docs:
  - tasks/slots/F70/F70-S08-defesa-em-profundidade-da-trava-da-ia.md
agent_id: backend-engineer
claimed_at: 2026-09-25T04:18:05Z

---
# F70-S11 — Bloquear referências cruzadas entre workspaces nas rotas de escrita

## Objetivo

Nenhuma rota de escrita aceitar id de outro workspace em campo de referência. Auditoria de 25/09: severidade média; integridade e disponibilidade do workspace alheio, sem vazamento de leitura.

## Contexto

As rotas usam `withWorkspace` (`hm_app` + `app.workspace_id`, FORCE RLS), mas a checagem de FK do Postgres roda fora da RLS: aceita qualquer id que exista em qualquer tenant. `uq_deals_conversation` é global, então um deal de A com a conversa de B impede B de criar o card da própria conversa (422 `no_default_pipeline`), inclusive no worker de lead ads. Exclusões de B cascateiam em dados de A, e o 500/201 serve de oráculo de existência de UUID.

Vulneráveis:
- `apps/api/src/routes/deals/crud.ts` POST e PUT (`pipelineId`, `stageId`, `contactId`, `conversationId`, `ownerId`); sem checagem `stage ∈ pipeline` nem visibilidade da conversa.
- `apps/api/src/routes/pipeline/stages.ts` (`pipelineId` da URL; `stages_pipeline_position_uq` global → DoS).
- `apps/api/src/routes/conversions/register.ts`, `conversions/events.ts`, `v1/index.ts` (conversões).
- `apps/api/src/services/event-service.ts` (calendário: `contactId`, `dealId`, `conversationId`).
- `apps/api/src/routes/flows/crud.ts` e `v1/index.ts` (`triggerFlow`).
- `apps/api/src/routes/contacts/contacts.ts`, `calendar/calendars.ts` (`ownerId`), `knowledge/feedback.ts` (`conversationId`).

Seguras: `pipeline/deal-conversation.ts`, `services/deal-move.ts`.

## Escopo

### files_allowed

- `packages/db/src/tenant-refs.ts`
- `packages/db/src/tenant-refs.test.ts`
- `packages/db/src/index.ts`
- `apps/api/src/routes/deals/**`
- `apps/api/src/routes/pipeline/stages.ts`
- `apps/api/src/routes/pipeline/*.test.ts`
- `apps/api/src/routes/conversions/**`
- `apps/api/src/services/event-service.ts`
- `apps/api/src/services/*.test.ts`
- `apps/api/src/routes/calendar/**`
- `apps/api/src/routes/flows/crud.ts`
- `apps/api/src/routes/flows/*.test.ts`
- `apps/api/src/routes/v1/index.ts`
- `apps/api/src/routes/v1/*.test.ts`
- `apps/api/src/routes/contacts/contacts.ts`
- `apps/api/src/routes/contacts/*.test.ts`
- `apps/api/src/routes/knowledge/feedback.ts`
- `apps/api/src/routes/knowledge/*.test.ts`

## Escopo (faz)

- Helper `assertRefsInWorkspace(tx, refs)` em `@hm/db`: um SELECT por id sob RLS, devolve os ausentes; também `stage.pipeline_id = pipelineId`.
- Todas as rotas listadas validam antes de escrever: id de outro workspace ou inexistente → 404/422 com o mesmo corpo (sem oráculo de existência).
- `deals` POST/PUT: `assertConversationVisible` quando vem `conversationId`; 23505 em `uq_deals_conversation` → 409.

## Fora de escopo

- FKs compostas no banco (F70-S12).

## Definition of Done

- [ ] teste: A cria/edita deal com contato, conversa, estágio e dono de B → 404/422, e B continua criando o card da própria conversa
- [ ] teste: estágio de outro pipeline → 422
- [ ] testes equivalentes para stages, conversões, eventos, flows, contatos, calendários, feedback
- [ ] resposta idêntica para "não existe" e "é de outro workspace"
