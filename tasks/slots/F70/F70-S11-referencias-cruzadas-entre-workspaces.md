---
id: F70-S11
title: Bloquear referências cruzadas entre workspaces nas rotas de escrita
phase: F70
status: review
priority: critical
estimated_size: M
depends_on: [F70-S08]
blocks: [F70-S12]
source_docs:
  - tasks/slots/F70/F70-S08-defesa-em-profundidade-da-trava-da-ia.md
agent_id: backend-engineer
claimed_at: 2026-09-25T04:18:05Z
completed_at: 2026-09-25T05:19:49Z

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

- [x] teste: A cria/edita deal com contato, conversa, estágio e dono de B → 404/422, e B continua criando o card da própria conversa
- [x] teste: estágio de outro pipeline → 422
- [x] testes equivalentes para stages, conversões, eventos, flows, contatos, calendários, feedback
- [x] resposta idêntica para "não existe" e "é de outro workspace"

## Decisões

- **Formato do erro:** campo de corpo inválido → **422** `{ error: 'invalid_reference', message, fields }`
  (`TenantRefError.body` / `invalidReferenceBody`, em `@hm/db`). `fields` lista só nomes de campo,
  ordenados; o corpo é o mesmo para UUID inexistente, UUID de outro workspace e id malformado. Id
  na URL (`/api/pipelines/:pipelineId/stages`) → **404** `{ error: 'pipeline_not_found' }`, mesma
  regra. Recurso-alvo por id (`PUT /api/deals/:id`, `PATCH /api/contacts/:id`) continua 404 e é
  checado ANTES do payload.
- **Helper:** `assertRefsInWorkspace(tx, refs)` faz uma consulta só (`UNION ALL` de um `SELECT` por
  tipo, ids agrupados em `IN`), sob a RLS do `tx` E com filtro explícito
  `workspace_id = app_current_workspace()`: fora de `withWorkspace` (papel dono) falha fechado.
  Id malformado não chega ao Postgres (não aborta a transação com 22P02).
- **Onde mora a trava:** nos serviços compartilhados (`registerConversion`, `event-service.createEvent`),
  para cobrir rota, API v1 e tool do agente de uma vez; nas rotas, quando a escrita é local.
  `registerConversion` LANÇA `TenantRefError` (em vez de novo `kind`) para não quebrar o `switch`
  exaustivo do tool do agente (fora deste slot): lá vira o 500 genérico do tool router.
- **Deals:** conversa passa por `assertConversationVisible` (conversa invisível ao membro = mesma
  resposta 422). `uq_deals_conversation` → 409 `conversation_already_has_deal`. Referência recusada
  não publica evento de domínio (F70-S09): a publicação está depois do commit, e o teste prova.
- **Stages:** posição repetida (`stages_pipeline_position_uq`) → 409 `stage_position_taken` no POST e
  no PUT (antes 500).

## Fica para a F70-S12

- FKs compostas `(workspace_id, id)` no banco: esta trava é da aplicação; caminhos que não passam
  por estas rotas (workers, scheduler, `bootstrap.registerConversion` do worker, tool
  `register_conversion` com `contact_id` vindo do LLM, `move_deal_stage`) seguem dependendo da RLS
  de leitura e ganham a garantia estrutural só com a S12.
- Arrays sem FK (`flows.channel_ids`, `filter_stage_ids`, `filter_tag_ids`,
  `conversion_events.attributed_campaign_id`) não foram validados: sem FK não há cascata nem
  índice único global para envenenar, e validar quebraria edição de flow com canal apagado.

## Validação

```bash
pnpm --filter @hm/db exec vitest run src/tenant-refs.test.ts --maxWorkers=2
pnpm --filter @hm/api exec vitest run src/routes/deals/cross-tenant.test.ts src/routes/pipeline/stages-cross-tenant.test.ts src/routes/conversions src/routes/v1/cross-tenant.test.ts --maxWorkers=2
pnpm --filter @hm/api exec vitest run src/routes/calendar src/routes/flows/cross-tenant.test.ts src/routes/contacts/cross-tenant.test.ts src/routes/knowledge/cross-tenant.test.ts --maxWorkers=2
pnpm --filter @hm/db typecheck
pnpm --filter @hm/api typecheck
```
