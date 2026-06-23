---
id: F47-S01
title: Schema products + deal_items + contacts.address/document (RLS)
phase: F47
status: done
priority: critical
estimated_size: M
depends_on: []
blocks: [F47-S02, F47-S03, F47-S04]
agent_id: db-engineer
source_docs:
  - docs/features/COCKPIT_CLIENT_ENRICHMENT.md
claimed_at: 2026-06-23T23:46:25Z
completed_at: 2026-06-23T23:46:41Z

---
# F47-S01 — Schema: products, deal_items, contacts.address/document + RLS

## Objetivo

Fundação de dados da feature: catálogo de **produtos**, **itens do card** (line-items) e os
campos cadastrais estruturados do **contato** (endereço + documento), com RLS multi-tenant,
índices e repos — sem consumir ninguém ainda.

## Contexto

Hoje não existe catálogo de produto no workspace (`billing.ts` é assinatura da plataforma) e
`contacts` não tem endereço estruturado. Este slot desbloqueia toda a API (S02/S03/S04).

## Escopo (faz)

- **Tabela `products`** (workspace-scoped, soft-delete): `id, workspace_id→workspaces(cascade),
  name, sku?, description?, price_cents bigint, currency text='BRL', active boolean=true,
  created_at, updated_at, deleted_at`.
  - `idx(workspace_id)` parcial `where deleted_at is null`.
  - `unique(workspace_id, sku)` parcial `where sku is not null and deleted_at is null`.
- **Tabela `deal_items`**: `id, workspace_id→workspaces(cascade), deal_id→deals(cascade),
  product_id→products(set null), name_snapshot text, qty integer, unit_price_cents bigint,
  currency text='BRL', position integer, created_at`.
  - `product_id` NULLABLE (item ad-hoc sem produto de catálogo).
  - `check(qty > 0)`, `check(unit_price_cents >= 0)`. `idx(deal_id)`.
- **ALTER `contacts`**: `+ address jsonb not null default '{}'` (tipo TS forte
  `{ cep?, street?, number?, complement?, district?, city?, state? }`) e `+ document text`.
- **RLS** em `products` e `deal_items`: policies por `workspace_id` espelhando o padrão das tabelas
  existentes (migration custom se o drizzle-kit não expressar — ver `0027`/conversions como exemplo).
- **Repos** em `@hm/db` para `products` e `deal_items` (CRUD básico + recompute helper de soma,
  consumido por S03). Tipos `$inferSelect`/`$inferInsert` exportados.
- Migration versionada (próximo número livre em `packages/db/drizzle/`) + snapshot.

## Fora de escopo

- Endpoints HTTP (S02/S03/S04). Recompute disparado por mutação (lógica fica em S03).
- Estoque/inventário. Multi-moeda por item.

## Arquivos permitidos

- `packages/db/src/schema/products.ts` (novo)
- `packages/db/src/schema/pipeline.ts` (adicionar `deal_items`; já é dono de deals)
- `packages/db/src/schema/contacts.ts` (adicionar `address`, `document`)
- `packages/db/src/schema/index.ts` (export do novo schema)
- `packages/db/src/repos/products.ts` (novo), `packages/db/src/repos/deal_items.ts` (novo)
- `packages/db/src/repos/index.ts` (se houver barrel)
- `packages/db/drizzle/**` (migration + meta snapshot)
- `packages/db/src/rls.test.ts` (cobertura RLS das novas tabelas)

## Arquivos proibidos

- `apps/**`, `packages/shared/**` (perms = S02), outros schemas não citados.

## Contratos de saída

- `products` e `deal_items` exportados de `@hm/db` (schema + tipos). `contacts.address` tipado.
- Repo helper `recomputeDealValue(tx, dealId)` disponível para S03 (soma dos itens → não grava;
  S03 decide gravar em `deals.value_cents`). Pode ser apenas o builder de soma se preferir.

## Definition of Done

- [ ] Migration aplica limpa em DB dev (`docker compose ... up -d`) e cria as 2 tabelas + colunas.
- [ ] RLS policy criada e testada (insert/select cross-workspace bloqueado) em `rls.test.ts`.
- [ ] Constraints (`qty>0`, `unit_price>=0`, unique sku parcial) validadas.
- [ ] `pnpm typecheck` + `pnpm lint` verdes; tipos `address` sem `any` (Zod/TS forte).

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas

- GOTCHA (memória): regra `.gitignore` engole dirs `secrets/` — não afeta aqui, mas atenção a globs.
- Índices funcionais/parciais que o drizzle-kit não expressa vão em migration custom (padrão da casa,
  ver `conversions`). Espelhe a RLS de `deals`/`contacts` para herdar o mesmo isolamento.
