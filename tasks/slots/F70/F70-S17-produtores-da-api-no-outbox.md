---
id: F70-S17
title: Produtores da API publicam pelo outbox
phase: F70
status: in-progress
priority: medium
estimated_size: S
depends_on: [F70-S16, F70-S11]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S16-outbox-transacional.md
agent_id: backend-engineer
claimed_at: 2026-09-25T06:21:42Z

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

- [ ] teste por produtor: rollback → nada no outbox; commit → uma linha com o `event_id` canônico
