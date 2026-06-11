---
id: F7-S03
title: API events (CRUD + cancel + rsvp) + event service (participants + notification seam)
phase: F7
status: done
priority: high
estimated_size: M
depends_on: [F7-S01, F7-S02]
agent_id: backend-engineer
claimed_at: 2026-06-11T16:55:54Z
completed_at: 2026-06-11T16:58:41Z

---
# F7-S03 — API events

> **source_docs:** `docs/features/CALENDAR.md` §4.3, §6, §7, §8; `docs/ROADMAP.md` F7-S03 (parte events)
> **blocks:** F7-S04, F7-S05, F7-S06

## Objetivo
API de eventos + o serviço central de criação: `events` CRUD (`GET ?calendar&dateRange&contact`, POST, `GET/PUT /:id`, `POST /:id/cancel`, `POST /:id/rsvp`) e `createEvent`/`cancelEvent` (insere evento + `event_participants` organizer/attendee + expõe **seam de notificação** preenchido por F7-S05).

## Escopo (faz)
- `apps/api/src/routes/calendar/events.ts`: endpoints §7 de events, validação Zod (start<end, dentro de disponibilidade é responsabilidade do caller), RLS.
- `apps/api/src/services/event-service.ts`: `createEvent(input, actor)` (evento + participants) e `cancelEvent` (status=cancelled + notifica), com seam `onEventChanged` (notificação/reminder em F7-S05) — sem acoplar.

## Fora de escopo
- compute_available_slots / calendars (F7-S01/S02), tools de agente (F7-S04 reusa `createEvent`), reminders worker (F7-S05), UI (F7-S06).

## Arquivos permitidos
- `apps/api/src/routes/calendar/events.ts`
- `apps/api/src/services/event-service.ts`

## Permission scope
- Criar evento → `event.edit` (STAFF, em calendar que pode acessar); editar/cancelar → `event.edit` (criador/organizer/ADMIN-OWNER refinado no service, §8). Cite `permissions.ts` (perms de F7-S02).

## Definition of Done
- [ ] events CRUD + cancel + rsvp sob RLS + Zod; `createEvent` cria evento + participants (organizer = dono do calendar, attendee = contact).
- [ ] `event-service` expõe seam `onEventChanged` (sem acoplar notificação).
- [ ] `pnpm --filter @hm/api test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- `createEvent` é reusado pelo tool `schedule_event` do agente (F7-S04) — fixe a assinatura aqui. Race de conflito é aceitável (§11): o agente chama `get_available_slots` antes.
