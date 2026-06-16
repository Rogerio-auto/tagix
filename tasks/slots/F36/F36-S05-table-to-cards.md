---
id: F36-S05
title: Padrão Tabela→Cards + filtros em sheet (primitivo + contatos)
phase: F36
status: blocked
priority: high
estimated_size: M
depends_on:
  - F36-S01
blocks:
  - F36-S08
  - F36-S09
  - F36-S10
  - F36-S13
  - F36-S14
source_docs:
  - docs/features/MOBILE_RESPONSIVE_PLAN.md
agent_id: frontend-engineer
---
# F36-S05 — Tabela→Cards

## Objetivo

Entregar o primitivo compartilhado que transforma tabelas densas em listas de cards no mobile (filtros/ordenação em bottom-sheet), e aplicá-lo na tela de **contatos** como referência. S08/S09/S10/S13 consomem o primitivo.

## Contexto

Tabelas densas (contatos, campanhas, conversões, deals, membros, tenants) têm scroll-x e alvos pequenos — ruins no toque. Consome `Sheet`/`useBreakpoint` de S01.

## Escopo (faz)

- **`apps/web/shared/components/ResponsiveTable/**`** (novo) — componente que renderiza tabela em `md+` e **lista de cards** em `< md` a partir de uma config de colunas (campos-chave + ação primária no card); slot de filtros que vira **bottom-sheet de filtros** no mobile + chips de filtro ativo; suporta empty/loading/error (§2.6/§2.7).
- **`apps/web/features/contacts/**`** — adotar `ResponsiveTable` na lista de contatos (referência da adoção); tocar card → detalhe em sheet.

## Fora de escopo

- Aplicar nas outras telas (S08 agents, S09 campaigns, S10 conversions, S13 tenants — cada uma adota o primitivo no seu slot).

## Arquivos permitidos

- `apps/web/shared/components/ResponsiveTable/**`
- `apps/web/features/contacts/**`
- `apps/web/app/(app)/contacts/page.tsx`

## Arquivos proibidos

- `apps/web/features/{campaigns,conversions,agents,platform-admin}/**`
- `apps/api/**`, `packages/**`

## Definition of Done

- [ ] `ResponsiveTable` exporta uma API reutilizável (colunas + ação primária + filtros) com os 3 estados.
- [ ] Contatos: `< md` lista de cards + filtros em sheet; `md+` tabela atual intacta.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- §2.6 empty/loading/error; §2.3 filtros em sheet; §3.8 density; alvos ≥44px.

## Notas

A API do primitivo é o contrato pros slots consumidores — deixe-a estável e documentada no próprio componente. Não acoplar a contatos.
