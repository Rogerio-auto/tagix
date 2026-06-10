---
id: F5-S04
title: API pipelines + stages (CRUD + reorder)
phase: F5
status: review
priority: high
estimated_size: M
depends_on: [F5-S02]
agent_id: backend-engineer
claimed_at: 2026-06-10T21:55:38Z
completed_at: 2026-06-10T22:00:08Z

---
# F5-S04 — API pipelines + stages

> **source_docs:** `docs/features/PIPELINE.md` §10, §3.1, §4.1; `docs/features/PERMISSIONS.md` (pipeline.edit); `docs/ROADMAP.md` F5-S02 (parte pipelines/stages)
> **blocks:** F5-S09, F5-S11, F5-S15

## Objetivo
API REST de pipelines e stages: CRUD de `pipelines` (+ `settings`/custom field defs), CRUD de `stages` (name/color/position/`automation_rules`/`transition_rules`), reorder de stages, e delete de stage com re-distribuição de deals para um fallback stage.

## Escopo (faz)
- `apps/api/src/routes/pipeline/pipelines.ts` + `stages.ts`: endpoints §10 (pipelines CRUD; `POST /pipelines/:id/stages`, `PUT /stages/:id`, `DELETE /stages/:id`, `PATCH /stages/reorder`), validação Zod dos jsonb (`AutomationRule[]`/`TransitionRules`/`CustomFieldDef[]`), RLS.
- Routers montados em `app.ts` pelo orchestrator (padrão F2-S19).

## Fora de escopo
- Deals/move (F5-S05), automation engine (F5-S06), UI (F5-S09+).

## Arquivos permitidos
- `apps/api/src/routes/pipeline/pipelines.ts`
- `apps/api/src/routes/pipeline/stages.ts`
- `apps/api/src/routes/pipeline/index.ts`

## Permission scope
- Escrita (pipelines/stages CRUD/reorder) → `pipeline.edit` (ADMINS); leitura → `deal.edit`/`flow.list`-equivalente (STAFF). Cite `permissions.ts`.

## Definition of Done
- [ ] CRUD pipelines+stages sob RLS + Zod; reorder atualiza positions atomicamente; delete de stage re-aloca deals para fallback.
- [ ] Guards de permissão por endpoint.
- [ ] `pnpm --filter @hm/api test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- `pipelines.settings.custom_fields[]` é a fonte das defs de custom field (consumido por F5-S11). Valide o shape `CustomFieldDef` no PUT.
