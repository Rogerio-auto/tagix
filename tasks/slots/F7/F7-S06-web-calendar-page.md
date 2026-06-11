---
id: F7-S06
title: Frontend CalendarPage (FullCalendar month/week/day) + EventForm + nav Agenda
phase: F7
status: done
priority: high
estimated_size: L
depends_on: [F7-S02, F7-S03]
agent_id: backend-engineer
claimed_at: 2026-06-11T17:25:50Z
completed_at: 2026-06-11T17:31:33Z

---
# F7-S06 — CalendarPage (web)

> **source_docs:** `docs/features/CALENDAR.md` §5.1, §5.2, §6, §7; `docs/UX_PRINCIPLES.md` §2/§3; `docs/ROADMAP.md` F7-S05
> **blocks:** —

## Objetivo
Tela de agenda (DS v2): `FullCalendar` com views month/week/day, seletor de calendar (próprio/time/workspace), click em horário vazio → modal de criação, click em evento → detalhe + ações (editar/cancelar). `EventForm` com título/tipo/datas/participantes (member + contact picker)/local/meeting URL/lembretes. **Re-adiciona o item "Agenda" no nav** (removido quando a página não existia).

## Escopo (faz)
- `apps/web/app/(app)/calendar/**`: rota da agenda.
- `apps/web/features/calendar/**`: `CalendarPage` (FullCalendar month/week/day), `EventForm`/`EventDetailModal`, calendar selector, `queries.ts`/`types.ts`.
- `apps/web/shared/components/layout/Sidebar.tsx`: re-adicionar `{ href: '/calendar', label: 'Agenda', icon: Calendar, perm: 'calendar.view' }`.

## Fora de escopo
- AvailabilityRulesPage (F7-S07), API (F7-S02/S03), reminders (F7-S05).

## Arquivos permitidos
- `apps/web/app/(app)/calendar/**`
- `apps/web/features/calendar/**`
- `apps/web/shared/components/layout/Sidebar.tsx`

## Definition of Done
- [ ] FullCalendar renderiza eventos nas 3 views; criar/editar/cancelar evento via modal funciona; seletor de calendar filtra; nav "Agenda" volta gated por `can('calendar.view')`.
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes (incl. dep `@fullcalendar/*` adicionada).

## UX considerations
- §2 entrada clara (Agenda no nav, não gear-only); §3 modal de evento curto (não full-screen), estados loading/empty/error; timezone exibido claro (§11 — UTC persistido, exibe no tz do member); tokens DS v2 (zero hex), inclusive nas cores de evento por tipo.

## Permission scope
- Ver → `calendar.view` (ALL, filtrado); criar/editar evento → `event.edit` (STAFF). Esconder ações sem permissão.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- Único slot da F7 que toca a Sidebar (fecha o link "Agenda" que foi removido por estar quebrado). Slot L — se passar de ~500 linhas, separe `EventForm` num slot sequencial. Adicionar `@fullcalendar/react` + plugins via `pnpm --filter @hm/web add`.
