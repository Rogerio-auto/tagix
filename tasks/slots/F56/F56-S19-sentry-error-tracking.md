---
id: F56-S19
title: Error tracking — ligar Sentry + captureException no error handler
phase: F56
status: available
priority: high
estimated_size: S
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
---

# F56-S19 — Sentry ligado em produção (QA-06/QA-15)

> **Origem:** AUDITORIA_TECNICA.md §3.10. Sentry é opt-in por DSN ausente em prod (`initSentry` no-op); `errorHandler` só faz `console.error` — exceções 500 vivem só no stdout.

## Objetivo

Fazer erros de produção existirem num agregador, com tag de `workspaceId`/`ref`.

## Contexto / causa raiz (verificada)

`apps/api/src/observability/sentry.ts:15-16` no-op sem DSN; `.env.production.example` sem `SENTRY_*`; `apps/api/src/middlewares/error.ts:40-62` sem `captureException`.

## Escopo (faz)

- Adicionar `SENTRY_DSN_API` (+ `SENTRY_DSN_WORKERS`, `HM_RELEASE`) ao `.env.production.example` com placeholders.
- `errorHandler` chama `captureException(err)` (no-op seguro se off) com tags `workspaceId`/`ref`.

## Escopo (não faz)

- Correlação de log por request (F56-S20 — `packages/logger` + `app.ts`). Provisionar o DSN real em prod (operacional).

## Arquivos permitidos

- `apps/api/src/observability/**`
- `apps/api/src/middlewares/error.ts`
- `.env.production.example`

## Arquivos proibidos

- `apps/api/src/app.ts` (F56-S20) · `packages/logger/**` (F56-S20)

## Definition of Done

- [ ] `.env.production.example` documenta os DSNs.
- [ ] `errorHandler` reporta ao Sentry (com tags) sem quebrar quando off.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- `error.ts` usa o `logger` de `@hm/logger`, que F56-S20 torna context-aware — não editar `packages/logger` aqui.
