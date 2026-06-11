---
id: F7-S04
title: Agent tools calendar — list_calendars + get_available_slots + schedule_event (callback Node)
phase: F7
status: review
priority: medium
estimated_size: M
depends_on: [F7-S01, F7-S03]
agent_id: backend-engineer
claimed_at: 2026-06-11T17:08:11Z
completed_at: 2026-06-11T17:14:20Z

---
# F7-S04 — Agent tools de calendar

> **source_docs:** `docs/features/CALENDAR.md` §4; `docs/AGENTS_LANGGRAPH.md` §6/§7; `docs/ROADMAP.md` F7-S04
> **blocks:** —

## Objetivo
Habilitar o agente IA a marcar reuniões via 3 tools categoria `calendar`: `list_calendars`, `get_available_slots` (chama `compute_available_slots`) e `schedule_event` (reusa `createEvent` de F7-S03; simula no playground via `is_playground`). Padrão callback Node (como `move_deal_stage`/`register_conversion` da F5).

## Escopo (faz)
- `apps/agent-runtime/app/tools/calendar/**`: defs Python (schema Pydantic + category='calendar') que despacham via callback HTTP ao Node (mecanismo de F2-S07).
- `apps/api/src/internal/tools/calendar-handlers.ts`: handlers Node `list_calendars`/`get_available_slots`/`schedule_event` (reusam os services de F7-S02/S03 sob RLS; `schedule_event` respeita `is_playground` → simula).
- Seed/catálogo: registrar as 3 tools em `tools` (global) para poderem ser habilitadas por agente.

## Fora de escopo
- Schema (F7-S01), services de calendar/event (F7-S02/S03), UI.

## Arquivos permitidos
- `apps/agent-runtime/app/tools/calendar/**`
- `apps/api/src/internal/tools/calendar-handlers.ts`
- `packages/db/src/seed/calendar_tools.ts`

## Arquivos proibidos
- `apps/api/src/internal/tools/workflow-handlers.ts` (dono: F2/F5 — handlers de calendar vão em arquivo próprio)
- `apps/api/src/internal/tools/registry.ts` (registro é gap-fill do orchestrator)

## Definition of Done
- [ ] As 3 tools resolvem via callback: `get_available_slots` retorna slots reais; `schedule_event` cria evento (ou simula no playground); `list_calendars` lista sob RLS.
- [ ] `ruff` + `pytest` (callback mockado) verdes; `pnpm --filter @hm/api test` (handlers) verde.

## Validação
```bash
uv run --directory apps/agent-runtime ruff check .
uv run --directory apps/agent-runtime pytest
pnpm --filter @hm/api test
```

## Notas
- Especialista sugerido: **python-engineer** (defs) + **backend-engineer** (handlers Node) — coordene; a lógica autoritativa fica no Node (reusa createEvent), o Python só declara schema + despacha. Registro na registry interna = gap-fill do orchestrator.
