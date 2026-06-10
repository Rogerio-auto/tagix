---
id: F5-S02
title: Schema pipeline (pipelines, stages, deals, deal_history, deal_attachments, pending_automations) + RLS
phase: F5
status: review
priority: critical
estimated_size: L
depends_on: []
agent_id: backend-engineer
claimed_at: 2026-06-10T21:46:52Z
completed_at: 2026-06-10T21:52:06Z

---
# F5-S02 — Schema Pipeline

> **source_docs:** `docs/DATA_MODEL.md` §10 (10.1–10.5); `docs/features/PIPELINE.md` §2, §3.1, §4.1, §8; `docs/ROADMAP.md` F5-S01
> **blocks:** F5-S03, F5-S04, F5-S05, F5-S06, F5-S08, F5-S15, F5-S16

## Objetivo
Modelar o domínio Pipeline em Drizzle + Postgres com RLS: `pipelines` (com `settings` jsonb p/ custom field defs — §8.1), `stages` (com `automation_rules`/`transition_rules` jsonb), `deals`, `deal_history` (event sourcing), `deal_attachments` (EXIF/GPS) e `pending_automations` (fila durável de automações — §3.3). **SEM `deal_tasks`** (removido, DATA_MODEL §10.6 / ROADMAP).

## Escopo (faz)
- `packages/db/src/schema/pipeline.ts`: as 5 tabelas de §10 + `pending_automations` (`id, workspace_id, deal_id, rule jsonb, scheduled_at, attempts, status, last_error`). CHECKs de enum (`deal_history.event_type`/`actor_type`), índices do §10 (incl. `idx_deals_workspace_pipeline_stage`).
- Tipos jsonb fortes (validados em runtime pela API/engine): `AutomationRule[]` (§3.1), `TransitionRules` (§4.1), `CustomFieldDef[]` (§8.1) em `pipelines.settings`.
- Barrel `schema/index.ts` (+ `RLS_TABLES`); migration de tabela + RLS por `app.workspace_id`.

## Fora de escopo
- Conversões (F5-S03), API/UI, automation worker (F5-S06), seeds (F5-S15). NADA de `deal_tasks`.

## Arquivos permitidos
- `packages/db/src/schema/pipeline.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`

## Definition of Done
- [ ] 6 tabelas criadas conforme §10 (+ `pending_automations`); `deals.stage_id` é `ON DELETE RESTRICT`.
- [ ] RLS criada e testada nas tabelas com `workspace_id`.
- [ ] Migrations geradas via drizzle-kit (RLS custom sem editar journal à mão).
- [ ] `pnpm --filter @hm/db test` + typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas
- Especialista sugerido: **db-engineer**.
- Custom field defs vivem em `pipelines.settings.custom_fields[]` (jsonb, §8.1) — NÃO há tabela dedicada. Valores em `deals.custom_fields` jsonb.
- Slot L — se passar de ~500 linhas, divida `pipelines/stages/deals` de `deal_history/deal_attachments/pending_automations` em 2 sequenciais.
