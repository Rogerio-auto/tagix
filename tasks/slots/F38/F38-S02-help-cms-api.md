---
id: F38-S02
title: API CMS Help Center (CRUD + publish), platform-admin
phase: F38
status: review
priority: high
estimated_size: M
depends_on:
  - F38-S01
blocks:
  - F38-S04
source_docs:
  - docs/features/SUPPORT.md
agent_id: backend-engineer
claimed_at: 2026-06-18T15:23:28Z
completed_at: 2026-06-18T15:31:55Z

---
# F38-S02 — API CMS Help Center

## Objetivo

Endpoints de gestão de conteúdo de ajuda (categorias + artigos), gated por `requirePlatformAdmin`. Consome `helpRepo` (S01). Alimenta a UI de CMS (S04).

## Contexto

Gate `requirePlatformAdmin` em `apps/api/src/middlewares/platform-admin.ts` (audita tentativas). Rotas platform vivem em `apps/api/src/routes/platform/`. Zod compartilhado em `@hm/shared` com exports explícitos (gotcha F34).

## Escopo (faz)

- **`apps/api/src/routes/platform/help.ts`** (novo) — sob `requirePlatformAdmin`: CRUD `help_categories` (create/update/delete/reorder) + `help_articles` (create/update/delete/reorder) + `POST .../:id/publish` + `POST .../:id/unpublish`. `published_at`/`created_by`/`updated_by` preenchidos server-side.
- **`apps/api/src/routes/platform/index.ts`** (ou onde o router platform é montado) — registrar `/platform/help`.
- **`packages/shared/src/help.ts`** (novo) — Zod de payloads (createCategory, updateCategory, createArticle, updateArticle, reorder) + tipos.
- **`packages/shared/src/index.ts`** — export explícito de `./help`.
- **`apps/api/src/routes/platform/help.test.ts`** — gate (não-admin → negado + audit), CRUD, publish/unpublish, validação Zod.

## Fora de escopo

- Endpoints de leitura (S03). UI (S04). Schema (S01).

## Arquivos permitidos

- `apps/api/src/routes/platform/help.ts`
- `apps/api/src/routes/platform/help.test.ts`
- `apps/api/src/routes/platform/index.ts`
- `packages/shared/src/help.ts`
- `packages/shared/src/index.ts`

## Arquivos proibidos

- `apps/web/**`, `packages/db/**`

## Definition of Done

- [ ] CRUD + publish/unpublish + reorder funcionam; gate `requirePlatformAdmin` cobre todas as rotas.
- [ ] Tentativa de não-admin é negada e auditada.
- [ ] Zod valida toda input; tipos exportados em `@hm/shared`.
- [ ] Integration test passa; `pnpm typecheck` + `pnpm lint` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

Mutações de conteúdo geram `audit_logs` (actor `platform_admin`) seguindo o padrão da fase F25.
</content>
