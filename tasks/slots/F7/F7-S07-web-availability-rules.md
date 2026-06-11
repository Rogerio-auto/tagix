---
id: F7-S07
title: Frontend AvailabilityRulesPage (settings → calendar) + exceções
phase: F7
status: in-progress
priority: medium
estimated_size: M
depends_on: [F7-S02]
agent_id: backend-engineer
claimed_at: 2026-06-11T17:00:51Z

---
# F7-S07 — AvailabilityRulesPage (web)

> **source_docs:** `docs/features/CALENDAR.md` §5.3, §7; `docs/UX_PRINCIPLES.md` §3; `docs/ROADMAP.md` F7-S06
> **blocks:** —

## Objetivo
Tela de disponibilidade (settings → calendar): editor de `availability_rules` por dia da semana (janela(s) start/end), quick presets ("Horário comercial Seg-Sex 9-18", "Tarde 14-18"), e gestão de `availability_exceptions` (datas/períodos bloqueados). Consome a API de F7-S02.

## Escopo (faz)
- `apps/web/app/(app)/settings/calendar/**`: rota.
- `apps/web/features/calendar/availability/**`: `AvailabilityRulesEditor` (grade por dia + presets), `ExceptionsManager` (adicionar/remover bloqueios), hooks de query.

## Fora de escopo
- CalendarPage/eventos (F7-S06), API (F7-S02).

## Arquivos permitidos
- `apps/web/app/(app)/settings/calendar/**`
- `apps/web/features/calendar/availability/**`

## Definition of Done
- [ ] Editar regras por dia (PUT bulk) com presets; adicionar/remover exceções; reflete no `compute_available_slots` (validável via slots endpoint).
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes.

## UX considerations
- §3 editor claro por dia (toggle disponível/indisponível, múltiplas janelas), presets como atalho (não substituem edição fina); estados loading/error; tokens DS v2 (zero hex).

## Permission scope
- Editar a própria disponibilidade → `availability.edit` (STAFF); ADMIN/OWNER podem editar de outros (refinado no service).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- Importa `queries.ts`/`types.ts` de F7-S06 se já existirem (read-only) ou define os seus de availability. Vive sob `/settings/calendar` (o índice `/settings` já redireciona — fix recente).
