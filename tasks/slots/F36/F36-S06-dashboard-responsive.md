---
id: F36-S06
title: Dashboard responsivo — grid→coluna + charts responsivos
phase: F36
status: blocked
priority: medium
estimated_size: S
depends_on:
  - F36-S01
blocks:
  - F36-S14
source_docs:
  - docs/features/MOBILE_RESPONSIVE_PLAN.md
agent_id: frontend-engineer
---
# F36-S06 — Dashboard responsivo

## Objetivo

Fazer o dashboard (home) fluir no celular: grid de cards → coluna única full-width, gráficos responsivos (lazy quando pesados).

## Contexto

Home role-aware com grid de métricas + charts. Consome `useBreakpoint` de S01.

## Escopo (faz)

- **`apps/web/features/dashboard/**`** + **`apps/web/app/(app)/page.tsx`** — `< md`: grid colapsa pra 1 coluna, cards full-width, drill-down em sheet; charts redimensionam (container responsivo) e carregam lazy se pesados. `md+` inalterado.

## Fora de escopo

- Mudança de métricas/queries do dashboard.

## Arquivos permitidos

- `apps/web/features/dashboard/**`
- `apps/web/app/(app)/page.tsx`
- `apps/web/app/(app)/loading.tsx`

## Arquivos proibidos

- `apps/api/**`, `packages/**`, `apps/web/features/!(dashboard)/**`

## Definition of Done

- [ ] `< md`: 1 coluna, cards full-width, charts não estouram a viewport.
- [ ] `md+`: layout atual intacto.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- §2.6 estados; §3.10 animação leve; performance (lazy de charts — §4.7 plano).

## Notas

Se os charts usam uma lib com `ResponsiveContainer`, garantir largura 100% e altura fixa por breakpoint. Drill-down já existe — abrir em sheet no mobile.
