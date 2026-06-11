---
id: F7-S01
title: Schema Calendar (calendars/availability_rules/exceptions/events/participants) + compute_available_slots + RLS
phase: F7
status: available
priority: critical
estimated_size: L
depends_on: []
---
# F7-S01 — Schema Calendar + função de slots

> **source_docs:** `docs/DATA_MODEL.md` §12; `docs/features/CALENDAR.md` §2, §3, §12.6; `docs/ROADMAP.md` F7-S01, F7-S02
> **blocks:** F7-S02, F7-S03, F7-S04, F7-S05

## Objetivo
Modelar o domínio Calendar em Drizzle + Postgres com RLS: `calendars` (personal/team/workspace), `availability_rules`, `availability_exceptions`, `events`, `event_participants` (§12), **mais a função PL/pgSQL `compute_available_slots`** (§3.1/§12.6 — buffer + min_notice + timezone do workspace) numa migration custom.

## Escopo (faz)
- `packages/db/src/schema/calendar.ts`: as 5 tabelas de §12 com FKs (workspace/owner member/calendar/event/contact/deal/conversation), CHECKs de enum (`calendar.type`, `event.type`/`status`, `participant.role`), índices do §12 (`idx_events`... `member_id,start_at`, `availability_rules(member_id,day_of_week)`).
- Migration custom para a função `compute_available_slots(workspace_id, member_id, date, interval, min_notice, buffer, max_slots)` exatamente como §3.1 (cruza rules × exceptions × events não-cancelados, respeita buffer/min_notice/timezone).
- Barrel `schema/index.ts` (+ `RLS_TABLES`); migration de tabela + RLS por `app.workspace_id`.

## Fora de escopo
- API/UI, tools de agente, reminders.

## Arquivos permitidos
- `packages/db/src/schema/calendar.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`

## Definition of Done
- [ ] 5 tabelas criadas conforme §12; função `compute_available_slots` aplicada e testada (retorna slots respeitando rules/exceptions/conflitos/buffer/min_notice).
- [ ] RLS criada e testada nas 5 tabelas (isolamento por `app.workspace_id`).
- [ ] Migrations geradas via drizzle-kit (função + RLS custom sem editar journal à mão).
- [ ] `pnpm --filter @hm/db test` + typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas
- Especialista sugerido: **db-engineer**.
- A função é `STABLE` e usa o `timezone` do workspace (não hardcoded). Teste com um member que tem rules + uma exceção + um evento conflitante para validar os 3 filtros.
