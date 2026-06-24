---
id: F47-S12
title: Fix race de auto-create do card (unique conversation_id + 23505)
phase: F47
status: review
priority: high
estimated_size: XS
depends_on: [F47-S01, F47-S04]
blocks: []
agent_id: db-engineer
source_docs:
  - docs/features/COCKPIT_CLIENT_ENRICHMENT.md
  - tasks/slots/F47/F47-S11-qa-security-e2e.md
claimed_at: 2026-06-24T01:22:50Z
completed_at: 2026-06-24T01:22:52Z

---
# F47-S12 — Fechar a race de auto-criação de card (follow-up MÉDIO do QA S11)

## Objetivo

Garantir idempotência REAL de `ensureDealForConversation` sob concorrência: hoje
`deals.conversation_id` não tem unique constraint, então duas requisições simultâneas
(criar card + auto-enrich, ou duplo-clique) criam 2 deals para a mesma conversa.

## Escopo (faz)

- **DB (packages/db):** unique index parcial `uq_deals_conversation` em `deals (conversation_id)
  WHERE conversation_id IS NOT NULL` (migration 0053 + `uniqueIndex` no schema `pipeline.ts`).
- **API (apps/api):** em `ensureDealForConversation` (`apps/api/src/routes/pipeline/deal-conversation.ts`),
  tratar `23505` (unique violation) no insert → re-selecionar e devolver o deal existente
  (idempotência fecha mesmo sob corrida).

## Arquivos permitidos

- `packages/db/src/schema/pipeline.ts`, `packages/db/drizzle/**`, `packages/db/src/rls.test.ts`
- `apps/api/src/routes/pipeline/deal-conversation.ts`, `apps/api/src/routes/pipeline/*.test.ts`

## Definition of Done

- [ ] Unique parcial criado; migration aplica limpa; `pnpm --filter @hm/db test` verde.
- [ ] `POST /api/conversations/:id/deal` concorrente = 1 deal (sem 500); `pnpm --filter @hm/api test` verde.
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
pnpm --filter @hm/api test
```

## Notas

- Follow-up do relatório de QA da F47-S11 (severidade MÉDIO). O índice sozinho já protege a
  integridade (DB rejeita o 2º insert); o catch de 23505 evita o 500 e devolve o existente.
