---
id: F8-S01
title: Schema F8 — dashboard_snapshots + materialized views + departments + teams + SLA config + RLS
phase: F8
status: review
priority: critical
estimated_size: L
depends_on: []
agent_id: backend-engineer
claimed_at: 2026-06-11T19:11:08Z
completed_at: 2026-06-11T19:17:39Z

---
# F8-S01 — Schema F8 (dashboard infra + org)

> **source_docs:** `docs/features/DASHBOARD.md` §5, §9.3; `docs/features/PERMISSIONS.md` §5; `docs/DATA_MODEL.md` §5/§15; `docs/ROADMAP.md` F8-S01
> **blocks:** F8-S02, F8-S07

## Objetivo
Fundação de dados da F8 workspace: `departments` + `teams` (não existiam — hoje são uuid sem FK em `conversations`/`calendar`), config de SLA (jsonb em workspace ou tabela `sla_rules`), `dashboard_snapshots` (métricas 5min) e as materialized views `mv_dashboard_*` (tendências 1h/1d), tudo com RLS. Backfill das FKs `department_id`/`team_id`.

## Escopo (faz)
- `packages/db/src/schema/org.ts`: `departments` (workspace-scoped, nome/descrição) + `teams` (department opcional, membros via join `team_members`) + SLA config (`sla_rules` ou coluna jsonb em workspace — escolha do db-engineer, documente).
- `packages/db/src/schema/dashboard.ts`: `dashboard_snapshots` (workspace_id, metric_key, scope jsonb, value jsonb, computed_at) + RLS.
- Migration custom para materialized views `mv_dashboard_*` (volume_24h, custo_mes, conversões agregadas — §2/§15) + índices.
- Backfill: adicionar FKs `conversations.department_id/team_id` e `calendars.team_id` (agora que as tabelas existem).
- Barrel `index.ts` (+ `RLS_TABLES`).

## Fora de escopo
- Serviço de métricas / refresh jobs (F8-S02), UI.

## Arquivos permitidos
- `packages/db/src/schema/org.ts`
- `packages/db/src/schema/dashboard.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`

## Definition of Done
- [ ] `departments`/`teams`/`team_members` + SLA config + `dashboard_snapshots` criados; MVs `mv_dashboard_*` aplicadas; FKs backfilladas.
- [ ] RLS criada e testada nas tabelas com `workspace_id`.
- [ ] Migrations via drizzle-kit (MVs/RLS custom sem editar journal à mão).
- [ ] `pnpm --filter @hm/db test` + typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas
- Especialista sugerido: **db-engineer**.
- `members.dashboard_layout` jsonb JÁ existe (não recriar). Slot L — se passar de ~500 linhas, separe org (departments/teams/SLA) de dashboard (snapshots/MVs) em 2 sequenciais.
