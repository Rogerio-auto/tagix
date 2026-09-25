---
id: F70-S20
title: Restos da outbox — envios da API v1, message.sent atômico, mídia da coexistência e emissor morto
phase: F70
status: blocked
priority: medium
estimated_size: S
depends_on: [F70-S17, F70-S19]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S16-outbox-transacional.md
  - tasks/slots/F70/F70-S17-produtores-da-api-no-outbox.md
---
# F70-S20 — Restos da outbox

## Objetivo

Todo job e todo evento que nasce de uma escrita no banco sair pela outbox, sem exceção, e o código morto do emissor pós-commit sair do repositório.

## Contexto

Pendências da F70-S16 e da F70-S17:
- `send_message`, `send_template` e `send_media` da API v1 publicam o job de outbound depois do commit (`publishOutboundJob`). `queueJobOutbox` já suporta essa fila.
- `message.sent` (`outbound/finalize.ts`) grava o evento numa transação separada, porque a persistência do status mora em `outbound/db-ports.ts`.
- Os jobs de mídia da coexistência continuam publicados depois do commit.
- `mark_resolved` dá a `conversation.resolved` um id de ocorrência aleatório: reexecutar a tool na mesma execução grava um segundo evento. O `transfer_to_human` já amarra o id ao `executionId`.
- `emitDomainEvent`/`emitDomainEvents` ficaram sem nenhum chamador de produção.

## Escopo

### files_allowed

- `apps/api/src/routes/v1/**`
- `apps/api/src/internal/tools/workflow-handlers.ts`
- `apps/api/src/internal/tools/*.test.ts`
- `apps/workers/src/outbound/**`
- `apps/workers/src/coexistence/**`
- `apps/workers/src/webhooks/e2e.test.ts`
- `packages/shared/src/mq/**`

## Escopo (faz)

- Envios da API v1 pela outbox, na transação que grava a mensagem.
- A porta de persistência do outbound aceita os eventos: `message.sent` fica na mesma transação do status.
- Jobs de mídia da coexistência pela outbox.
- `mark_resolved`: `event_id` derivado do `executionId`, como o do handoff.
- Remover `emitDomainEvent`/`emitDomainEvents` e ajustar docs e testes que ainda os citam.

## Definition of Done

- [ ] teste: rollback no envio v1 → nenhum job na outbox; commit → um job
- [ ] teste: `message.sent` some junto quando a gravação do status falha
- [ ] teste: `mark_resolved` repetido na mesma execução → um evento só
- [ ] `git grep emitDomainEvent` sem resultado
