---
id: F37-S01
title: Calendar 2.0 — schema recorrência + provisionamento + helper de acesso
phase: F37
status: review
priority: critical
estimated_size: M
depends_on: []
blocks:
  - F37-S02
source_docs:
  - docs/features/CALENDAR_V2_PLAN.md
agent_id: db-engineer
claimed_at: 2026-06-18T00:43:09Z
completed_at: 2026-06-18T00:47:18Z

---
# F37-S01 — Schema + provisionamento + acesso

## Objetivo

Camada de dados do Calendar 2.0: colunas de recorrência em `events`, repo de provisionamento (calendário pessoal por membro + "Empresa" do workspace) e o helper de calendários acessíveis por membro. É a fundação — S02 consome.

## Contexto

O schema já tem `calendars` (`personal/team/workspace`, owner, color) e `canAccessCalendar` (`apps/api/src/middlewares/calendar-access.ts`). Falta: recorrência (D1=sim), provisionamento (L2) e um helper reutilizável de "quais calendários este membro vê" (para escopar lista+eventos em S02, fechando o vazamento L1).

## Escopo (faz)

- **`packages/db/src/schema/calendar.ts`** — `events`: adicionar `recurrence_rule text` (RRULE simplificado, ex.: `FREQ=WEEKLY;BYDAY=MO,WE`), `recurrence_until timestamptz`, `recurrence_parent_id uuid` (self-ref nullable, p/ overrides/exceções futuras). Manter retrocompat (colunas nullable; evento simples = rule null).
- **`packages/db/drizzle/00XX_f37_calendar_recurrence.sql`** + **`00YY_...rls.sql`** se necessário — migration das colunas (próximos números livres em `packages/db/drizzle/`; entrada no `meta/_journal.json`).
- **`packages/db/src/repos/calendar.ts`** (novo) — `calendarRepo`:
  - `ensurePersonalCalendar(tx, workspaceId, memberId)` → cria/retorna o calendário `personal` (owner=member) idempotente.
  - `ensureWorkspaceCalendar(tx, workspaceId)` → cria/retorna o "Empresa" (`type='workspace'`, isDefault) idempotente.
  - `accessibleCalendarIds(tx, { memberId, role })` → ids dos calendários que o membro pode ver: próprio pessoal + workspace + times do membro (`team_members`, F8) + (OWNER/ADMIN) todos os pessoais + (SUPERVISOR) pessoais/times dos times que lidera. Espelha a lógica de `canAccessCalendar`, estendida com `team_members`.
- **`packages/db/src/repos/index.ts`** + **`packages/db/src/index.ts`** — exportar `calendarRepo` no barrel (lembrete: o barrel raiz NÃO faz `export *`; exporte explicitamente — gotcha F34).
- **`packages/db/src/rls.test.ts`** — teste do `accessibleCalendarIds` (membro comum não vê pessoal de colega; owner vê; supervisor vê seus times) + provisionamento idempotente.

## Fora de escopo

- Rotas/serviços de API (S02). UI (S03/S04).

## Arquivos permitidos

- `packages/db/src/schema/calendar.ts`
- `packages/db/src/repos/calendar.ts`
- `packages/db/src/repos/index.ts`
- `packages/db/src/index.ts`
- `packages/db/drizzle/00XX_f37_calendar_recurrence.sql`
- `packages/db/drizzle/00YY_f37_calendar_rls.sql`
- `packages/db/drizzle/meta/_journal.json`
- `packages/db/src/rls.test.ts`

## Arquivos proibidos

- `apps/**`
- `packages/db/src/schema/!(calendar).ts`

## Contratos de saída

- `events.recurrence_rule/recurrence_until/recurrence_parent_id`.
- `calendarRepo.{ensurePersonalCalendar, ensureWorkspaceCalendar, accessibleCalendarIds}` em `@hm/db` — consumido por S02.

## Definition of Done

- [ ] Migration aplica limpo (Postgres dev); colunas nullable, sem quebrar eventos existentes.
- [ ] `calendarRepo` exporta as 3 funções; provisionamento idempotente; `accessibleCalendarIds` correto por role.
- [ ] RLS/isolamento testado (incl. membro comum NÃO acessa pessoal de colega).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/db test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas

`team_members` (F8) já existe — usar para o acesso de time (não restringir a "managers" como o middleware atual). Recorrência v1: armazenar a regra; a EXPANSÃO em ocorrências é na query da API (S02). Manter o RRULE simples (FREQ DAILY/WEEKLY + BYDAY + UNTIL) — sem lib pesada se um parser pequeno resolver.
