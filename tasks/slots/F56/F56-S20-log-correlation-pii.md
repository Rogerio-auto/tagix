---
id: F56-S20
title: Observabilidade — correlação de log por workspace/request + redação PII
phase: F56
status: available
priority: high
estimated_size: M
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
---

# F56-S20 — Log correlacionado por tenant + PII (QA-05/QA-12)

> **Origem:** AUDITORIA_TECNICA.md §3.10. `@hm/logger` não tem contexto request-scoped (0 `.child()` com ids) — impossível filtrar logs por `workspace_id`/request. Redação de PII é allowlist frágil (não cobre `msisdn/wa_id/document/cpf`).

## Objetivo

Tornar todo log correlacionável por `workspace_id`/`request_id` e cobrir os campos de PII faltantes.

## Contexto / causa raiz (verificada)

`packages/logger/src/index.ts` sem AsyncLocalStorage/contexto; `middlewares/error.ts` usa `randomUUID` por erro (não propagado). `REDACT_PATHS` não cobre `msisdn/wa_id/document/cpf/address/to`.

## Escopo (faz)

- Contexto request-scoped via `AsyncLocalStorage` em `@hm/logger`; helper `child()` com `requestId`+`workspaceId`.
- Middleware `apps/api/src/middlewares/request-context.ts` que injeta o contexto (aceita `x-request-id`) e o registra cedo em `app.ts`.
- Ampliar `REDACT_PATHS` (msisdn/wa_id/document/cpf/address/to) e/ou redator por heurística de valor.

## Escopo (não faz)

- Sentry (F56-S19 — `error.ts`/`observability`). Workers `child()` por job (follow-up; interface fica pronta aqui).

## Arquivos permitidos

- `packages/logger/src/**`
- `apps/api/src/middlewares/request-context.ts`
- `apps/api/src/app.ts`

## Arquivos proibidos

- `apps/api/src/middlewares/error.ts` (F56-S19) · `apps/api/src/observability/**` (F56-S19)

## Definition of Done

- [ ] Logs de uma request carregam `requestId`+`workspaceId` (teste).
- [ ] `msisdn/wa_id/document/cpf/address` são redigidos.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Este é o **único** slot que edita `apps/api/src/app.ts` nesta fase — registre o middleware cedo, sem reordenar os demais.
