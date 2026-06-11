---
id: F7-S02
title: API calendars + availability (rules/exceptions) + slots endpoint + permissões calendar.*
phase: F7
status: blocked
priority: high
estimated_size: M
depends_on: [F7-S01]
---
# F7-S02 — API calendars + availability

> **source_docs:** `docs/features/CALENDAR.md` §7, §8; `docs/ROADMAP.md` F7-S03 (parte calendars/availability)
> **blocks:** F7-S03, F7-S06, F7-S07

## Objetivo
API de calendars e disponibilidade: CRUD de `calendars`, `availability_rules` (GET + PUT bulk), `availability_exceptions` (GET/POST/DELETE), e o wrapper REST `GET /api/availability/slots` sobre `compute_available_slots`. Define as **permissões `calendar.*`** na matriz (não existem ainda).

## Escopo (faz)
- `apps/api/src/routes/calendar/calendars.ts` + `availability.ts`: endpoints §7 (calendars CRUD; rules GET/PUT; exceptions GET/POST/DELETE; `/availability/slots`), validação Zod, RLS, middleware `requireCalendarAccess` (§8).
- `packages/shared/src/permissions.ts`: adicionar `calendar.view` (ALL), `calendar.manage` (MANAGERS), `availability.edit` (STAFF), `event.edit` (STAFF) — o filtro fino de ownership é service-layer (nota do topo de permissions.ts).
- Routers montados em `app.ts` pelo orchestrator (padrão F2-S19).

## Fora de escopo
- Events CRUD (F7-S03), tools de agente (F7-S04), UI (F7-S06/S07).

## Arquivos permitidos
- `apps/api/src/routes/calendar/calendars.ts`
- `apps/api/src/routes/calendar/availability.ts`
- `apps/api/src/middlewares/calendar-access.ts`
- `packages/shared/src/permissions.ts`

## Permission scope
- Ver calendars/slots → `calendar.view` (ALL, filtrado por escopo no service); criar/editar/deletar calendar → `calendar.manage` (MANAGERS); editar availability → `availability.edit` (STAFF, só as suas).

## Definition of Done
- [ ] CRUD calendars + availability + slots endpoint sob RLS + Zod; `requireCalendarAccess` aplica o modelo de §8.
- [ ] Permissões `calendar.*` adicionadas e usadas nos guards.
- [ ] `pnpm --filter @hm/api test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Dono de `permissions.ts` na F7 — F7-S03 importa as perms read-only. O `/availability/slots` chama a função PL/pgSQL de F7-S01 via `sql`.
