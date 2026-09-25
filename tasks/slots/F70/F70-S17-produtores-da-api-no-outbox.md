---
id: F70-S17
title: Produtores da API publicam pelo outbox
phase: F70
status: review
priority: medium
estimated_size: S
depends_on: [F70-S16, F70-S11]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S16-outbox-transacional.md
agent_id: backend-engineer
claimed_at: 2026-09-25T06:21:42Z
completed_at: 2026-09-25T06:42:53Z

---
# F70-S17 — Produtores da API publicam pelo outbox

## Objetivo

Os eventos que a API emite (status da conversa, deals, conversões, API pública, tools da IA) terem a mesma garantia dos eventos dos workers.

## Escopo

### files_allowed

- `apps/api/src/routes/conversations/state.ts`
- `apps/api/src/routes/deals/crud.ts`
- `apps/api/src/routes/v1/index.ts`
- `apps/api/src/routes/conversions/events.ts`
- `apps/api/src/internal/tools/router.ts`
- `apps/api/src/internal/tools/registry.ts`
- testes ao lado desses arquivos

## Escopo (faz)

- Trocar a publicação depois do commit por `enqueueOutbox(tx, …)` dentro da transação, em cada produtor da F70-S09.
- As tools da IA gravam `result.events` no outbox na transação do router.

## Definition of Done

- [x] teste por produtor: rollback → nada no outbox; commit → uma linha com o `event_id` canônico

## Decisões

- **Produtores migrados** (todos gravam com `enqueueOutbox(tx, domainEventsOutbox([...]))` na
  transação `withWorkspace`/`req.scoped` do dado; nenhum grant novo, o papel é o `hm_app`):
  - `POST /api/conversations/:id/status`: `conversation.resolved` e `conversation.opened`
    (`reopened`), só em transição real. A mudança em `state.ts` ficou restrita ao handler de
    status (o `ai-mode`, que a F70-S19 toca, não mudou);
  - `POST /api/deals`: `deal.created`; `POST /api/deals/:id/move-stage`: `deal.stage_changed`
    (o no-op para o mesmo estágio não grava); `close-won`/`close-lost`: `deal.won`/`deal.lost`,
    com a ocorrência no `closed_at` lido pelo RETURNING da própria transação;
  - `POST /api/conversions` e `POST /api/v1/conversions`: `conversion.registered`, só quando
    `registerConversion` devolve `created` (o dedup do dia não grava);
  - `POST /api/v1/deals/:id/move`: `deal.stage_changed` com autor `api`;
  - tools da IA (`internal/tools/router.ts`): `result.events` entram na outbox dentro da
    transação do handler, depois da barreira de habilitação, só se `ok`. A auditoria em
    `tool_logs` continua numa transação própria, depois do commit e best-effort.
- **Evento de outro workspace (tools):** a RLS `outbox_tenant_insert` recusa (42501) e a ação
  inteira volta, com 500 ao runtime. É fail-closed de propósito: um handler que declara evento
  de outro tenant é defeito, e nenhuma mutação sai sem o aviso correspondente.
- **Contrato violado:** segue logado e descartado por `domainEventsOutbox`, sem derrubar a
  mutação (mesma semântica do emissor antigo).
- **Prova de atomicidade nos testes:** `deals/__tests__/forced-rollback.ts` embrulha o
  `withWorkspace` real e, armado, lança depois de todo o trabalho (dado + outbox) e antes do
  COMMIT. A outbox é lida pelo `workspace_id` numa conexão à parte (`deals/__tests__/outbox.ts`,
  mesmo critério de `apps/workers/src/outbox/testing.ts`), então uma linha visível está
  commitada.
- **`emitDomainEvent`/`emitDomainEvents`:** não têm mais uso de produção no repositório. Restam
  a definição e a doc em `packages/shared/src/mq/domain-events.ts`, uma menção em
  `packages/shared/src/mq/outbox.ts` e os testes `packages/shared/src/mq/domain-events.test.ts`
  e `apps/workers/src/webhooks/e2e.test.ts`. Não foi removido (fora da fronteira): a remoção fica
  para um slot de `@hm/shared`.

## Validação

```bash
pnpm --filter @hm/api exec vitest run src/routes/deals/outbox.integration.test.ts src/routes/deals/cross-tenant.test.ts src/routes/conversions/outbox.integration.test.ts src/routes/conversions/cross-tenant.test.ts --maxWorkers=2
pnpm --filter @hm/api exec vitest run src/routes/v1/outbox.integration.test.ts src/routes/v1/cross-tenant.test.ts src/routes/conversations/state.outbox.integration.test.ts src/routes/conversations/state.test.ts src/routes/conversations/__tests__/cycle-timestamps.integration.test.ts --maxWorkers=2
pnpm --filter @hm/api exec vitest run src/internal/tools/workflow-handlers.domain-events.test.ts src/internal/tools/access.integration.test.ts src/internal/tools/router.test.ts --maxWorkers=2
pnpm --filter @hm/api typecheck
```

## Resumo

- **Testes (Postgres dev real):** 12 arquivos, 107 testes.
  - novos de outbox: deals 8, conversões 2, API v1 5, status da conversa 4;
  - tools da IA 6 (2 novos: rollback depois do enqueue; evento de outro workspace);
  - adaptados de `emitDomainEvent` para leitura da outbox: cross-tenant de deals, conversões e
    v1, `state.test.ts` (unit), `cycle-timestamps`, `access.integration`;
  - também passam: `router.test.ts` 13, `v1/routes.test.ts` 28, `conversions/routes.test.ts` 7,
    `pipeline/deal-*` 32.
- **Pendências:**
  - `mark_resolved` (em `workflow-handlers.ts`, fora da fronteira) usa ocorrência aleatória em
    `conversation.resolved`. Uma reexecução da tool na mesma execução grava outro evento. O
    `transfer_to_human` já amarra a ocorrência ao `executionId`;
  - `POST /api/v1/send_message|send_template|send_media` publicam o job de outbound depois do
    commit (`publishOutboundJob`), sem a garantia da outbox. A fila `hm.q.outbound` já aceita job
    pela outbox (`queueJobOutbox`). Não era produtor da F70-S09, então ficou fora deste slot;
  - remover `emitDomainEvent`/`emitDomainEvents` de `@hm/shared` (sem uso de produção).

