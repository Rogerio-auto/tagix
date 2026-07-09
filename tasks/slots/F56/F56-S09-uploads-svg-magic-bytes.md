---
id: F56-S09
title: Uploads — bloquear SVG + validar magic bytes
phase: F56
status: available
priority: medium
estimated_size: S
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
---

# F56-S09 — Uploads: SVG e magic bytes (SEC-06)

> **Origem:** AUDITORIA_TECNICA.md §3.1. O upload libera qualquer `image/*` (inclui `image/svg+xml`) e confia no `Content-Type` do cliente sem sniff — XSS armazenado via SVG e spoof de tipo.

## Objetivo

Impedir upload de SVG executável e de bytes que não correspondem ao tipo declarado.

## Contexto / causa raiz (verificada)

`apps/api/src/routes/uploads.ts:38,51-56,86-88` — allow por prefixo `image/`, mime só do header, sem magic bytes.

## Escopo (faz)

- Bloquear `image/svg+xml` explicitamente.
- Validar magic bytes (ex. `file-type`) e casar com o prefixo declarado; rejeitar divergência.
- No serve/persistência, forçar `Content-Disposition: attachment` e `Content-Type` sanitizado.

## Escopo (não faz)

- Limite de concorrência do sharp (follow-up F45). Storage/R2 (fora).

## Arquivos permitidos

- `apps/api/src/routes/uploads.ts`
- `apps/api/src/routes/uploads.test.ts`

## Arquivos proibidos

- `apps/api/src/media/**` · `packages/storage/**`

## Definition of Done

- [ ] Upload de `.svg` é rejeitado.
- [ ] Bytes arbitrários rotulados `image/png` são rejeitados (magic bytes).
- [ ] Teste cobre os dois casos.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- `file-type` é ESM-only; conferir compat com o setup de teste (vitest) do @hm/api.
