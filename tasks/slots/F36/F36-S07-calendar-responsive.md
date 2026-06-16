---
id: F36-S07
title: Calendário responsivo — agenda/dia no mobile
phase: F36
status: in-progress
priority: medium
estimated_size: M
depends_on:
  - F36-S01
blocks:
  - F36-S14
source_docs:
  - docs/features/MOBILE_RESPONSIVE_PLAN.md
agent_id: frontend-engineer
claimed_at: 2026-06-16T20:39:23Z

---
# F36-S07 — Calendário responsivo

## Objetivo

Substituir a grade de mês (ruim em tela estreita) por uma visão **agenda/dia** rolável no mobile, com criação/edição de evento em sheet.

## Contexto

Calendar usa grade de mês. Consome `Sheet`/`useBreakpoint` de S01.

## Escopo (faz)

- **`apps/web/features/calendar/**`** + **`apps/web/app/(app)/calendar/page.tsx`** — `< md`: visão agenda (lista de eventos por dia, navegável por data) ou dia único; tocar evento → detalhe em sheet; criar evento → sheet. `md+`: grade de mês intacta.

## Fora de escopo

- Mudança de API de eventos/disponibilidade. Settings de calendário (S10).

## Arquivos permitidos

- `apps/web/features/calendar/**`
- `apps/web/app/(app)/calendar/page.tsx`

## Arquivos proibidos

- `apps/web/features/settings/**`, `apps/api/**`, `packages/**`

## Definition of Done

- [ ] `< md`: agenda/dia rolável; criar/ver evento em sheet; navegação de data por toque.
- [ ] `md+`: grade de mês inalterada.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- §3.9 timeline vertical pra eventos; §2.3 sheet; alvos ≥44px.

## Notas

Reusar os dados de `/api/events` + slots de disponibilidade existentes; só a visualização muda por breakpoint.
