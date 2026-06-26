---
id: F50-S07
title: Fix — uuidParamGuard 404 nas rotas /api/flows/backup/* (carve-out)
phase: F50
status: available
priority: high
estimated_size: XS
depends_on: [F50-S04]
blocks: []
agent_id: backend-engineer
source_docs:
  - docs/features/FLOW_BUILDER.md
---

# F50-S07 — Carve-out de `backup` no uuidParamGuard

## Objetivo

Corrigir o 404 em TODAS as rotas `/api/flows/backup/*` para usuários autenticados: o
`uuidParamGuard` trata o segmento `backup` como `:id` de `flows`, e por não ser UUID nem estar
na allowlist, responde 404 ANTES do router de backup. Adicionar `backup` aos literais de carve-out.

## Contexto

Bug real do export (reportado como "não baixa"): o request `GET /api/flows/backup/export` retornava
**404** (não download). Diagnóstico com sessão real (Supabase admin token): unauth=401 (sem token o
guard é no-op), authed=404 (token presente → guard valida `backup` na posição de `:id` de flows → 404).
`uuid-params.ts` já tem carve-out p/ `executions`/`manual-order` sob /api/flows/*; falta `backup`.

## Escopo (faz)

- `apps/api/src/middlewares/uuid-params.ts`: adicionar `'backup'` ao set `NON_UUID_LITERALS`
  (junto dos literais de `/api/flows/*`), com comentário.
- `apps/api/src/middlewares/uuid-params.test.ts`: caso garantindo que `/api/flows/backup/export`
  (autenticado) passa (`next()`, sem 404).

## Fora de escopo

- Qualquer outra rota/router. Lógica de backup (S03/S04).

## Arquivos permitidos

- `apps/api/src/middlewares/uuid-params.ts`
- `apps/api/src/middlewares/uuid-params.test.ts`

## Arquivos proibidos

- Todo o resto.

## Definition of Done

- [ ] `/api/flows/backup/export|preview|import` (autenticado) não tomam 404 do guard.
- [ ] Teste cobre `backup` passando.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api exec vitest run uuid-params` verdes.
- [ ] Validado em prod após deploy: export autenticado retorna 200.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api exec vitest run src/middlewares/uuid-params.test.ts
```

## Notas

- Lição: rotas literais sob uma coleção `ID_AFTER` precisam entrar em `NON_UUID_LITERALS` senão o guard
  as 404'a para usuários autenticados (o guard só age COM sessão — por isso passou despercebido nos
  testes de 401 sem sessão).
