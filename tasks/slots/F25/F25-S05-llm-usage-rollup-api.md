---
id: F25-S05
title: LLM usage rollup API — gasto por workspace/modelo/dia-mês + top spenders + caps
phase: F25
status: in-progress
priority: high
estimated_size: M
depends_on: [F25-S01]
agent_id: backend-engineer
source_docs:
  - docs/ROADMAP.md#F2.5
claimed_at: 2026-06-13T01:27:54Z

---
# F25-S05 — LLM usage rollup API

> **source_docs:** `docs/ROADMAP.md` F2.5-S05
> **blocks:** F25-S08

## Objetivo

API de plataforma que agrega `llm_usage_logs` para o dashboard de custo do super-admin: gasto (USD) e tokens por **workspace**, por **modelo**, por **dia/mês**; **top spenders**; e **alertas de cap próximo** (workspaces chegando perto do `max_monthly_cost_usd` da policy). Gated por `requirePlatformAdmin`.

## Contexto

`llm_usage_logs` (workspace-scoped, RLS) já é populada pela F2 com custo detalhado de cada chamada (router openrouter/openai_direct, tokens, custo). Como a plataforma agrega cross-workspace, as queries de rollup NÃO usam RLS de tenant (rodam como owner/agregação) — o guard é a fronteira. Cruza com `workspace_agent_policies.max_monthly_cost_usd` para os alertas.

## Escopo (faz)

- `apps/api/src/routes/platform/usage.ts` (novo): `GET /platform/usage/summary?from=&to=&groupBy=workspace|model|day` (agregações), `GET /platform/usage/top-spenders?period=month`, `GET /platform/usage/cap-alerts` (workspaces com gasto-mês ≥ X% do cap). `requirePlatformAdmin` + Zod nos query params.
- Queries SQL agregadas eficientes (índices existentes de `llm_usage_logs`).
- Teste (rollup determinístico com seed).

## Fora de escopo

- Guard (S01). Frontend dashboard (S08). Escrita em llm_usage_logs (F2).

## Arquivos permitidos

- `apps/api/src/routes/platform/usage.ts`
- `apps/api/src/routes/platform/usage.test.ts`

## Arquivos proibidos

- `apps/api/src/app.ts`, outros `routes/platform/*` (S02/S03/S04)

## Definition of Done

- [ ] Summary agrega por workspace/model/day; top-spenders ordena por gasto; cap-alerts cruza com policy.max_monthly_cost_usd.
- [ ] Agregações cross-workspace corretas (sem vazar dados sensíveis além do necessário ao painel); query params validados.
- [ ] `pnpm --filter @hm/api test` (seed determinístico) + lint/typecheck verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**.
- Exporta `createPlatformUsageRouter()` p/ o orchestrator wire. Cuidar de performance (agregação pode varrer muitas linhas — use os índices de `llm_usage_logs`).
