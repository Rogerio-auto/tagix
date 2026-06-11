---
id: F8-S02
title: Dashboard metrics service + API /dashboard/me (role-filtered) + socket + refresh jobs
phase: F8
status: in-progress
priority: high
estimated_size: L
depends_on: [F8-S01]
agent_id: backend-engineer
claimed_at: 2026-06-11T19:19:22Z

---
# F8-S02 — Dashboard metrics + API

> **source_docs:** `docs/features/DASHBOARD.md` §2, §5, §8, §9; `docs/ROADMAP.md` F8-S01, F8-S06
> **blocks:** F8-S03, F8-S04

## Objetivo
Backend dos dashboards: serviço de métricas (queries por categoria §2.1–§2.6, lendo tabelas + `dashboard_snapshots` + MVs), API `GET /api/dashboard/me` que retorna **apenas os cards/alerts que o role pode ver** (filtragem server-side §8), `GET /api/dashboard/metrics/:key` (drill-down), socket `dashboard:metric_changed` filtrado por role, e os **refresh jobs** (cron que popula snapshots 5min + refresh das MVs 1h/1d).

## Escopo (faz)
- `apps/api/src/services/dashboard/**`: catálogo de métricas (cada uma com fonte/cadência/roles), montagem de `{ role, cards[], alerts[], layout_preferences }` filtrado por role, e os endpoints.
- `apps/api/src/routes/dashboard/**`: `GET /dashboard/me` + `/metrics/:key` (router montado em app.ts pelo orchestrator).
- Socket `dashboard:metric_changed` em `socket-events.ts` + emissão nos pontos relevantes (estado operacional do agente).
- `apps/workers/src/dashboard-refresh/**`: cron que popula `dashboard_snapshots` (5min) + `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_*` (1h/1d).

## Fora de escopo
- UI (F8-S03), customização (F8-S04), schema (F8-S01).

## Arquivos permitidos
- `apps/api/src/services/dashboard/**`
- `apps/api/src/routes/dashboard/**`
- `apps/workers/src/dashboard-refresh/**`
- `packages/shared/src/socket-events.ts`

## Permission scope
- `GET /dashboard/me` retorna só o que o role do member pode ver (§8/§10) — server nunca manda card que o role não pode operar. Conversões só se o workspace tem ≥1 `conversion_type` (§13).

## Definition of Done
- [ ] `GET /dashboard/me` retorna cards/alerts corretos por role (testa AGENT vs SUPERVISOR vs ADMIN vs OWNER vs READONLY); drill-down `/metrics/:key` funciona.
- [ ] Refresh jobs populam snapshots e dão refresh nas MVs; socket emite estado operacional.
- [ ] `pnpm --filter @hm/api test` + `pnpm --filter @hm/workers test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
pnpm --filter @hm/workers test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Slot L (muitas métricas) — se passar de ~500 linhas, separe métricas operacionais (§2.1, realtime) das analíticas (§2.2–§2.6, MV/snapshot) em 2 sequenciais. Refresh jobs registrados no bootstrap = gap-fill orchestrator.
