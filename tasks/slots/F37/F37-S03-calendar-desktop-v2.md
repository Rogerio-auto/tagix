---
id: F37-S03
title: Calendar 2.0 — desktop (trilha multi-calendário + agendamento rico + form 2.0)
phase: F37
status: in-progress
priority: high
estimated_size: L
depends_on:
  - F37-S02
blocks:
  - F37-S04
  - F37-S05
source_docs:
  - docs/features/CALENDAR_V2_PLAN.md
  - docs/UX_PRINCIPLES.md
  - docs/MOBILE_UX.md
agent_id: frontend-engineer
claimed_at: 2026-06-18T01:02:07Z

---
# F37-S03 — Calendar 2.0 desktop

## Objetivo

A tela de calendário desktop repensada (UI/UX trabalhada, DS v2): trilha lateral de calendários com cor + liga/desliga (overlay), eventos coloridos por calendário, agendamento por arraste (criar/mover/redimensionar), `EventForm` 2.0 com recorrência e participantes, e personalização (mini-mês, "Hoje", help, atalhos).

## Contexto

Hoje é um FullCalendar com **um dropdown** (um calendário por vez) + cor por tipo. O founder quer a experiência estilo Google Calendar (pessoal + Empresa + times; owner vê todos), mais interativa, dentro do DS. Consome a API de S02 (`calendarIds`, recorrência, visibilidade).

## Escopo (faz)

- **`apps/web/features/calendar/CalendarRail/**`** (novo) — trilha lateral: grupos **Meu calendário · Empresa · Times · (OWNER/ADMIN) Pessoas**, cada item com ponto de cor + nome + **checkbox de visibilidade**; estado de seleção persistido por membro (localStorage). Legenda de cores.
- **`apps/web/features/calendar/CalendarPage.tsx`** — layout 2 colunas (trilha + grade); FullCalendar com:
  - eventos dos calendários **selecionados** (`useEvents({ calendarIds })`), **coloridos por calendário** (`calendars.color`), default **semana (timeGridWeek)**.
  - arraste-pra-criar (existe) + **arraste-pra-mover/redimensionar** (`editable`, `eventDrop`/`eventResize` → PUT start/end, com permissão/ownership; revert no erro).
  - **popover** de evento ao clicar (resumo + ações) antes do detalhe completo.
  - mini-mês navegador + botão "Hoje" + switcher de visão (mês/semana/dia/agenda).
  - empty/loading/error (§2.6/§2.7), `?` HelpPanel contextual (§2.5), atalhos (`n` novo, `t` hoje, `1/2/3` visão).
- **`apps/web/features/calendar/EventForm.tsx`** — form 2.0: seletor de **calendário**, tipo, **participantes** (membros), local/URL, contato/deal, e **recorrência** (não repete / diária / semanal com dias / até-data). Validação Zod inline.
- **`apps/web/features/calendar/EventDetailModal.tsx`** — detalhe rico: participantes + RSVP, recorrência legível, editar/cancelar (série na v1).
- **`apps/web/features/calendar/{queries.ts,types.ts}`** — `calendarIds[]`, cor por calendário, recorrência, participantes (data layer; S04 consome).
- **`apps/web/features/calendar/{LazyCalendarPage.tsx,index.ts}`** + **`apps/web/app/(app)/calendar/page.tsx`** — ajustes de montagem se necessário.

## Fora de escopo

- Mobile (`MobileAgenda.tsx` — S04). API/schema (S01/S02). Availability settings.

## Arquivos permitidos

- `apps/web/features/calendar/CalendarPage.tsx`
- `apps/web/features/calendar/EventForm.tsx`
- `apps/web/features/calendar/EventDetailModal.tsx`
- `apps/web/features/calendar/LazyCalendarPage.tsx`
- `apps/web/features/calendar/queries.ts`
- `apps/web/features/calendar/types.ts`
- `apps/web/features/calendar/index.ts`
- `apps/web/features/calendar/CalendarRail/**`
- `apps/web/app/(app)/calendar/page.tsx`

## Arquivos proibidos

- `apps/web/features/calendar/MobileAgenda.tsx` (S04)
- `apps/web/features/calendar/availability/**`
- `apps/api/**`, `packages/**`

## Definition of Done

- [ ] Trilha com Meu/Empresa/Times/(owner)Pessoas, cor + liga/desliga, overlay de vários; seleção persiste.
- [ ] Eventos coloridos por calendário + legenda; default semana.
- [ ] Arraste cria/move/redimensiona (com permissão; revert no erro); popover de evento.
- [ ] `EventForm` 2.0 com recorrência + participantes; detalhe com RSVP + recorrência legível.
- [ ] Mini-mês, "Hoje", switcher, help `?`, atalhos, empty/loading/error.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- §2.1 clique no corpo abre popover/detalhe (não engrenagem); §2.3 detalhe em drawer/modal proporcional, não full-screen; §2.5 help em `?`; §2.6 empty convida; §2.7 feedback nas mutations (move/resize/criar); §2.10 atalhos; §3.5 cursor/hover; §3.10 animações < 250ms. DS v2: cor por calendário via tokens/paleta curada, zero hex em JSX, dark-first, brand 1×/tela.

## Notas

Slot grande de propósito: é UMA tela e a coerência de UX importa mais que fragmentar. Reusar o `Sheet`/utilitárias de S0 (F36) quando útil. `queries.ts`/`types.ts` são o data layer que o mobile (S04) consome — deixe-os completos.
