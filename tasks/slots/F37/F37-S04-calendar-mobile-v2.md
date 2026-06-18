---
id: F37-S04
title: Calendar 2.0 — mobile (trilha como sheet + cor por calendário)
phase: F37
status: available
priority: medium
estimated_size: M
depends_on:
  - F37-S03
blocks:
  - F37-S05
source_docs:
  - docs/features/CALENDAR_V2_PLAN.md
  - docs/MOBILE_UX.md
agent_id: frontend-engineer
---
# F37-S04 — Calendar 2.0 mobile

## Objetivo

Levar o multi-calendário ao mobile: a agenda (F36-S07) passa a respeitar a seleção de calendários (overlay), colore por calendário, e ganha a **trilha como `Sheet`** (escolher quais calendários ver).

## Contexto

`MobileAgenda` (F36-S07) hoje filtra por 1 calendário via `<select>` e colore por tipo. Reconciliar com o modelo multi-calendário de S03 (mesmo data layer `queries.ts`/`types.ts`).

## Escopo (faz)

- **`apps/web/features/calendar/MobileCalendarRail.tsx`** (novo) — trilha de calendários como `Sheet` (`@/shared/components/Sheet`): grupos Meu/Empresa/Times/(owner)Pessoas com cor + checkbox; mesma seleção persistida que o desktop.
- **`apps/web/features/calendar/MobileAgenda.tsx`** — consumir a seleção multi-calendário (`calendarIds`) de S03, colorir eventos **por calendário**, botão "Calendários" abre o `MobileCalendarRail` (sheet); ocorrências de recorrência aparecem; criar/abrir evento reusa os sheets de S03.

## Fora de escopo

- Desktop (S03). API/schema.

## Arquivos permitidos

- `apps/web/features/calendar/MobileAgenda.tsx`
- `apps/web/features/calendar/MobileCalendarRail.tsx`

## Arquivos proibidos

- `apps/web/features/calendar/CalendarPage.tsx`, `EventForm.tsx`, `EventDetailModal.tsx`, `queries.ts`, `types.ts` (consome de S03, não edita)
- `apps/api/**`, `packages/**`

## Definition of Done

- [ ] Agenda mobile respeita a seleção multi-calendário e colore por calendário.
- [ ] Trilha como `Sheet` (cor + liga/desliga), seleção compartilhada com o desktop.
- [ ] Recorrência visível; criar/abrir evento funciona no toque.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- §2.3 trilha→sheet; thumb-first (MOBILE_UX); alvos ≥44px; cor por calendário consistente com o desktop.

## Notas

Não duplicar o data layer — importar `queries.ts`/`types.ts` (donos = S03). O estado de seleção de calendários deve ser a MESMA fonte (hook/localStorage) do desktop pra continuidade.
