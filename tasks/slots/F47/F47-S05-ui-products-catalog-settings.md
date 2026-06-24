---
id: F47-S05
title: UI Catálogo de Produtos em Settings (/settings/products)
phase: F47
status: in-progress
priority: medium
estimated_size: M
depends_on: [F47-S02]
blocks: [F47-S11]
agent_id: frontend-engineer
source_docs:
  - docs/features/COCKPIT_CLIENT_ENRICHMENT.md
  - docs/features/PERMISSIONS.md
  - docs/UX_PRINCIPLES.md
ux_considerations:
  - "Aplica 2.6 — empty state com CTA 'Adicionar primeiro produto'."
  - "Aplica 2.3 — criar/editar em drawer lateral (sheet no mobile), não modal full-screen."
  - "Aplica 2.7 — loading nos saves + skeleton na lista."
  - "Aplica 2.9 — produto = soft-delete com confirmação simples."
claimed_at: 2026-06-24T00:36:14Z

---
# F47-S05 — Catálogo de Produtos em Configurações

## Objetivo

Página de gestão do catálogo de produtos dentro de Settings (`/settings/products`): listar, buscar,
criar, editar e arquivar produtos — consumindo a API de S02.

## Contexto

Settings tem um registry de seções (`features/settings/shell/registry.tsx`) e seções podem ser
`component` ou `externalHref`. O catálogo entra como seção do grupo **workspace**, gated por
`product.edit`.

## Escopo (faz)

- Nova feature `apps/web/features/products/**`: lista (busca + filtro ativo + paginação), formulário
  de criar/editar (drawer/sheet), arquivar (soft-delete). React Query (`queries.ts`).
- Rota `apps/web/app/(app)/settings/products/page.tsx`.
- Registrar seção no `registry.tsx` (grupo `workspace`, `permission: 'product.edit'`,
  `externalHref: '/settings/products'`, keywords: produto/catálogo/preço/sku).
- 3 estados (empty/loading/populated); valores em BRL formatados; inputs ≥16px (mobile).

## Fora de escopo

- Vincular produto ao card (S07). API (S02). Itens do deal (S03).

## Arquivos permitidos

- `apps/web/features/products/**` (novo)
- `apps/web/app/(app)/settings/products/page.tsx` (novo)
- `apps/web/features/settings/shell/registry.tsx` (adicionar a seção)

## Arquivos proibidos

- `apps/web/features/conversations/**`, `apps/web/features/contacts/**`,
  `apps/web/features/pipeline/**`, `apps/web/shared/components/layout/**` (S10).

## Definition of Done

- [ ] CRUD do catálogo funcional contra a API; soft-delete some da lista ativa.
- [ ] Seção aparece em Settings só para quem tem `product.edit`; busca Cmd+K acha por keyword.
- [ ] Empty/loading/error states; DS v2 (zero hex hardcoded, tokens semânticos); responsivo (sheet).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Permission scope

- Acesso/edição = `product.edit` (OWNER/ADMIN). Esconder no front é UX; backend autoritativo (S02).

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Espelhar padrão de seções existentes que são página dedicada via `externalHref` (ex.: conversões,
  pipeline-settings no registry). Reusar `Sheet`/`useBreakpoint` para o form no mobile.
