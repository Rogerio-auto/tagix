---
id: F41-S04
title: Wire vitest no @hm/web + integrar os testes do console (F41-S03)
phase: F41
status: in-progress
priority: high
estimated_size: S
depends_on:
  - F41-S03
blocks: []
source_docs:
  - docs/features/SUPPORT.md
agent_id: frontend-engineer
claimed_at: 2026-06-19T16:17:23Z

---
# F41-S04 — Harness de teste unitario do @hm/web

## Objetivo

Wirar vitest no `@hm/web` (que hoje so tem Playwright) para que os 2 testes
do console (F41-S03, ja verdes sob vitest) rodem no gate padrao do projeto sem
quebrar `pnpm --filter @hm/web typecheck`/`build`. Fecha o gap de infra
registrado em COMMS.md (F41-S03) — mesmo gap que o @hm/ui (F10-S05) documentou.

## Contexto

`apps/web/features/developers/snippets.test.ts` + `console-walls.test.ts`
(entregues no S03) importam de `vitest`, que nao e devDep do web; o tsconfig
do web inclui `**/*.ts` -> TS2307. Precisamos: devDep vitest, config vitest
(environment node, include do glob de testes), script "test", e excluir os
testes do compile do Next/tsc de producao (ou dar os types ao tsc).

## Escopo (faz)

- `apps/web/package.json` — devDep `vitest` (versao do workspace) + script
  `"test": "vitest run"`.
- `apps/web/vitest.config.ts` (novo) — `environment: 'node'`, `include`
  dos `*.test.ts(x)` do feature, `globals: true`.
- `apps/web/tsconfig.json` — garantir que os `*.test.ts` typecheckam (types
  do vitest) OU sao excluidos do build de producao do Next, sem quebrar o
  typecheck. Manter `pnpm --filter @hm/web build` verde (Next nao deve tentar
  compilar testes em rota).
- Rodar e deixar verdes os 2 testes do S03.

## Fora de escopo

- Logica de produto (S01/S02). Novos testes alem dos do S03.

## Arquivos permitidos

- `apps/web/package.json`
- `apps/web/vitest.config.ts`
- `apps/web/tsconfig.json`
- `apps/web/tsconfig.test.json`

## Definition of Done

- [ ] `pnpm --filter @hm/web test` roda os 2 testes do S03 -> verdes.
- [ ] `pnpm --filter @hm/web typecheck` + `build` verdes (sem TS2307).
- [ ] Sem mudanca em codigo de produto.

## Notas

Mantem o padrao do @hm/ui (vitest + config dedicado). Idealmente sem novo
lockfile churn alem do vitest ja presente no store.
