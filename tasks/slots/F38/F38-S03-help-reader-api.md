---
id: F38-S03
title: API leitor de ajuda (list/get/anchor + busca FTS + feedback)
phase: F38
status: in-progress
priority: high
estimated_size: M
depends_on:
  - F38-S01
blocks:
  - F38-S05
  - F38-S06
source_docs:
  - docs/features/SUPPORT.md
agent_id: backend-engineer
claimed_at: 2026-06-18T15:32:22Z

---
# F38-S03 — API leitor de ajuda

## Objetivo

Endpoints de leitura de ajuda para qualquer membro autenticado (só `status='published'`), incluindo busca full-text e feedback. Alimenta o leitor `/help` (S05) e o help contextual `(?)` (S06).

## Contexto

`helpRepo` (S01) já expõe `listPublishedCategories`, `getArticleBySlug`, `getArticleByAnchor`, `searchArticles`, `upsertFeedback`. Middleware de auth padrão (`requireAuth`) — sem gate de role; leitura é universal.

## Escopo (faz)

- **`apps/api/src/routes/help.ts`** (novo) — `GET /api/help/categories` (com count de publicados), `GET /api/help/articles?category=&q=` (FTS quando `q`), `GET /api/help/articles/:slug`, `GET /api/help/articles/by-anchor/:anchorKey`, `POST /api/help/articles/:id/feedback` (helpful + comment; upsert por member). Nunca retorna `draft`.
- **`apps/api/src/app.ts`** — montar o router `/api/help` (linha de montagem; não alterar mais nada).
- **`packages/shared/src/help.ts`** — adicionar Zod de query/response do leitor + feedback (coordenar com S02 que cria o arquivo; se S02 já criou, estender).
- **`apps/api/src/routes/help.test.ts`** — draft não vaza; FTS retorna ranqueado; feedback faz upsert; by-anchor resolve.

## Fora de escopo

- CMS/escrita de conteúdo (S02). UI (S05/S06). Schema (S01).

## Arquivos permitidos

- `apps/api/src/routes/help.ts`
- `apps/api/src/routes/help.test.ts`
- `apps/api/src/app.ts`
- `packages/shared/src/help.ts`
- `packages/shared/src/index.ts`

## Arquivos proibidos

- `apps/web/**`, `packages/db/**`, `apps/api/src/routes/platform/**`

## Definition of Done

- [ ] Só artigos publicados são retornados; busca FTS funciona em pt; by-anchor resolve.
- [ ] Feedback faz upsert por (article, member) e respeita RLS de workspace.
- [ ] Integration test passa; `pnpm typecheck` + `pnpm lint` verdes.

## Notas

`packages/shared/src/help.ts` é compartilhado com S02 — exports explícitos no barrel; se rodarem em paralelo, o orchestrator serializa a edição do `index.ts`.
</content>
