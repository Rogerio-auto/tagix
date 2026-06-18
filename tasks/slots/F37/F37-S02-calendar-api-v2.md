---
id: F37-S02
title: Calendar 2.0 — API (visibilidade + recorrência + provisionamento)
phase: F37
status: available
priority: critical
estimated_size: M
depends_on:
  - F37-S01
blocks:
  - F37-S03
  - F37-S05
source_docs:
  - docs/features/CALENDAR_V2_PLAN.md
agent_id: backend-engineer
---
# F37-S02 — API Calendar 2.0

## Objetivo

Expor a visibilidade correta (fechando o vazamento L1), a recorrência e o provisionamento na API de calendário.

## Contexto

Hoje `GET /api/calendars` lista TUDO e `GET /api/events` (sem filtro) retorna todos os eventos do workspace → membro comum vê o pessoal dos colegas (**vazamento L1**). Consome `calendarRepo` (S01).

## Escopo (faz)

- **`apps/api/src/routes/calendar/calendars.ts`** — `GET /api/calendars` filtra por `calendarRepo.accessibleCalendarIds` (membro só vê os que pode); **provisionamento lazy**: ao listar, garante o pessoal do membro + o "Empresa" (idempotente). Mantém `calendar.manage` p/ CRUD.
- **`apps/api/src/routes/calendar/events.ts`** — `GET /api/events`: escopar por calendários acessíveis (default = todos os acessíveis), suportar `calendarIds` (CSV/array) para overlay; **expandir ocorrências de recorrência** dentro da janela `from/to` (via serviço de recorrência). `POST/PUT` aceitam `recurrenceRule`/`recurrenceUntil`. Edit/cancel de série: v1 aplica à série (documentar).
- **`apps/api/src/middlewares/calendar-access.ts`** — `canAccessCalendar`: `team` passa a usar `team_members` (F8) + SUPERVISOR vê times que lidera (alinhar com `accessibleCalendarIds`).
- **`apps/api/src/services/calendar-recurrence.ts`** (novo) — parse do RRULE simples + `expandOccurrences(event, from, to)` (gera instâncias virtuais; ids sintéticos `evt:<id>:<occurrenceStart>` para o front abrir/editar a série).
- **`apps/api/src/services/event-service.ts`** — `createEvent`/update persistem recorrência; default do calendário = pessoal do criador quando não informado.
- **`apps/api/src/routes/calendar/routes.test.ts`** — regressão do vazamento (membro comum NÃO vê eventos de calendário inacessível), overlay `calendarIds`, expansão de recorrência na janela, provisionamento.

## Fora de escopo

- UI (S03/S04). Schema/repo (S01).

## Arquivos permitidos

- `apps/api/src/routes/calendar/calendars.ts`
- `apps/api/src/routes/calendar/events.ts`
- `apps/api/src/middlewares/calendar-access.ts`
- `apps/api/src/services/event-service.ts`
- `apps/api/src/services/calendar-recurrence.ts`
- `apps/api/src/routes/calendar/routes.test.ts`

## Arquivos proibidos

- `apps/api/src/routes/calendar/availability.ts`
- `apps/web/**`, `packages/**`

## Contratos de entrada/saída

- `GET /api/events?calendarIds=a,b&from&to` → eventos dos calendários acessíveis selecionados, com ocorrências de recorrência expandidas.
- `GET /api/calendars` → só os calendários visíveis ao membro (provisiona pessoal+Empresa).
- Evento com `recurrenceRule`/`recurrenceUntil`.

## Definition of Done

- [ ] Membro comum NÃO recebe eventos/calendários inacessíveis; owner/admin veem todos; supervisor vê seus times (teste cobre).
- [ ] `calendarIds` faz overlay; recorrência expande corretamente na janela `from/to`.
- [ ] Provisionamento idempotente (pessoal + Empresa) no primeiro acesso.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Permission scope

- `calendar.view` continua ALL, mas o ESCOPO de dados agora é por `accessibleCalendarIds` (defesa real, não só a matriz). `event.edit`=STAFF; ownership fino (criador/admin) mantido. Cita `docs/features/PERMISSIONS.md`.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

Ids sintéticos de ocorrência permitem o front abrir uma instância e editar a série. Manter retrocompat dos endpoints existentes (sem `calendarIds` = todos os acessíveis). O serviço de recorrência é puro/testável.
