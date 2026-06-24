---
id: F47-S02
title: API Produtos — CRUD /api/products + perms product.*
phase: F47
status: review
priority: high
estimated_size: M
depends_on: [F47-S01]
blocks: [F47-S05, F47-S11]
agent_id: backend-engineer
source_docs:
  - docs/features/COCKPIT_CLIENT_ENRICHMENT.md
  - docs/features/PERMISSIONS.md
claimed_at: 2026-06-24T00:20:59Z
completed_at: 2026-06-24T00:21:00Z

---
# F47-S02 — API de Produtos (catálogo do workspace)

## Objetivo

CRUD HTTP do catálogo de produtos sob RLS, com permissões novas `product.view` (ALL) e
`product.edit` (ADMINS), validação Zod e testes — consumido pelo Cockpit (S07) e pelo Settings (S05).

## Contexto

S01 criou a tabela `products`. Falta a superfície HTTP + as permissões tipadas em `@hm/shared`.

## Escopo (faz)

- **Permissões** em `packages/shared/src/permissions.ts`: `'product.view': ALL`,
  `'product.edit': ADMINS` (mesmos sets já usados por contact/pipeline).
- **Rotas** `apps/api/src/routes/products/`:
  - `GET /api/products` — lista + busca (`q` por nome/sku) + filtro `active` + paginação
    (offset/limit, espelhar contacts). Gate `product.view`.
  - `POST /api/products` — cria. Gate `product.edit`. Zod: `name` obrigatório, `price_cents>=0`,
    `currency` default BRL, `sku?` (409 em duplicado por workspace).
  - `PATCH /api/products/:id` — edita (partial). Gate `product.edit`.
  - `DELETE /api/products/:id` — **soft-delete** (`deleted_at`). Gate `product.edit`.
- Registrar o router no app (`apps/api/src/app.ts` ou agregador de rotas).
- Testes de rota (happy path + authz + 409 sku + RLS scoping) em `*.test.ts`.

## Fora de escopo

- Itens do card (S03). UI (S05). Vínculo produto↔deal (S03/S07).

## Arquivos permitidos

- `apps/api/src/routes/products/**` (novo)
- `apps/api/src/app.ts` (apenas registrar o router — linha de mount)
- `packages/shared/src/permissions.ts` (adicionar as 2 chaves)

## Arquivos proibidos

- `packages/db/**` (S01 é dono do schema), `apps/web/**`, outras rotas.

## Contratos de entrada/saída

- `GET /api/products` → `{ products: Product[], page, pageSize, total, totalPages }`.
- `POST`/`PATCH` → `{ product: Product }`. `DELETE` → 204. 409 `duplicate_sku` em SKU repetido.

## Definition of Done

- [ ] CRUD funcional sob `req.scoped` (RLS); cross-workspace não vaza.
- [ ] `product.view`/`product.edit` aplicados via `requireRole`; READONLY não cria/edita (403).
- [ ] Zod valida payload; 400 com issues; 409 em SKU duplicado; soft-delete não some do banco.
- [ ] `pnpm typecheck` + `pnpm lint` + testes de rota verdes.

## Permission scope

- `product.view` = OWNER/ADMIN/SUPERVISOR/AGENT/READONLY (PERMISSIONS.md §2.2 — leitura ampla).
- `product.edit` = OWNER/ADMIN (gestão de catálogo).

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Espelhar a estrutura de `apps/api/src/routes/contacts/contacts.ts` (guards, paginação, 409 23505).
- Mesmo objeto de permissões é importado no frontend (`can()`), então a chave precisa existir aqui.
