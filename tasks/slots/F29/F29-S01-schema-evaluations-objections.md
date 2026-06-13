---
id: F29-S01
title: Schema — conversation_evaluations + objections + RLS + repos
phase: F29
status: review
priority: critical
estimated_size: M
depends_on: []
agent_id: db-engineer
source_docs:
  - docs/features/AGENT_QUALITY_OBJECTIONS.md
  - docs/DATA_MODEL.md
claimed_at: 2026-06-13T16:16:22Z
completed_at: 2026-06-13T16:24:13Z

---
# F29-S01 — Schema da Onda B (db)

> **source_docs:** `docs/features/AGENT_QUALITY_OBJECTIONS.md` §3; `docs/DATA_MODEL.md`
> **blocks:** F29-S03, F29-S04

## Objetivo

Criar as tabelas que armazenam o resultado do LLM-judge: `conversation_evaluations` (qualidade da resposta + sentimento/CSAT + quem atuou) e `objections` (objeções classificadas por conversa). Ambas workspace-scoped, com RLS, índices de agregação e repos.

## Contexto

A F29 mede qualidade/CSAT/objeções via avaliação pós-conversa. Estas tabelas são a fonte das métricas (F29-S04) e o destino do worker de persistência (F29-S03). `main` está verde e `packages/db` estável (seed-demo fix mergeado) — sem migration concorrente.

## Escopo (faz)

- `packages/db/src/schema/evaluations.ts` (novo): `conversation_evaluations` (vide §3 do doc — `quality_score` 0-100, `sentiment_score` -100..100, `csat_label`, `handled_by ai|human|mixed`, `agent_id`/`primary_member_id` SET NULL, `judge_model`, `judge_cost_usd`, `raw` jsonb, **UNIQUE(conversation_id)**) + `objections` (`category`, `label`, `excerpt`, `resolved`, FK `evaluation_id` CASCADE). Índices: `(workspace_id, evaluated_at)`, `(workspace_id, agent_id)`, `(workspace_id, primary_member_id)`, `(workspace_id, category)`, `(workspace_id, occurred_at)`.
- `packages/db/src/schema/index.ts` (editar): export + registrar **ambas** em `RLS_TABLES`.
- Migration versionada (`drizzle-kit generate` + bloco RLS manual no `.sql`, padrão do repo) — policy `USING (workspace_id = current_setting('app.workspace_id')::uuid)` nas duas tabelas.
- `packages/db/src/repos/evaluations.ts` (novo): upsert por `conversation_id`, insert de objections, e leituras agregadas usadas por F29-S04 (avg quality/sentiment, ranking por categoria, por agente, por member).
- `packages/db/src/rls.test.ts` (editar): cross-tenant nega leitura de `conversation_evaluations` e `objections`.

## Fora de escopo

- LLM-judge (F29-S02), worker (F29-S03), métricas/UI (F29-S04/S05).
- Materialized views (agregação é query viva no MVP).

## Arquivos permitidos

- `packages/db/src/schema/evaluations.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/repos/evaluations.ts`
- `packages/db/drizzle/**`
- `packages/db/src/rls.test.ts`

## Arquivos proibidos

- Qualquer outro schema/arquivo de `packages/db` não listado; `apps/**`.

## Definition of Done

- [ ] `conversation_evaluations` + `objections` criadas com checks/FKs/índices do §3; `UNIQUE(conversation_id)`.
- [ ] Ambas em `RLS_TABLES` + policy RLS na migration; **teste cross-tenant nega** (DoD obrigatório de tabela com `workspace_id`).
- [ ] Repos com upsert idempotente + leituras agregadas tipadas (sem `any`).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/db test` verdes; migration aplica limpa.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas

- Especialista: **db-engineer**. Espelhe o padrão de `conversions.ts` (FKs para conversations/agents/members, índices parciais na migration custom).
- `judge_cost_usd numeric` — o custo do judge também é logado em `llm_usage_logs` pelo agent-runtime (F29-S02); aqui é só denormalização para auditoria por conversa.
