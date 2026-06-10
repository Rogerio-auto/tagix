---
id: F2-S01
title: Schema de agentes IA (agents, templates, tools, executions, llm usage, policies)
phase: F2
status: review
priority: critical
estimated_size: L
depends_on: []
agent_id: backend-engineer
claimed_at: 2026-06-10T03:10:07Z
completed_at: 2026-06-10T03:10:13Z

---
# F2-S01 — Schema de agentes IA

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §1; `docs/DATA_MODEL.md` (domínio de agentes); `docs/ROADMAP.md` F2-S01
> **blocks:** F2-S05, F2-S06, F2-S07, F2-S08, F2-S09, F2-S13, F2-S14, F2-S15, F2-S16

## Objetivo
Modelar todo o domínio de agentes IA em Drizzle + Postgres com RLS multi-tenant: `agents`, `agent_templates`, `agent_template_questions`, `tools`, `agent_tools`, `tool_logs`, `agent_executions`, `agent_metrics`, `llm_usage_logs`, `llm_models_whitelist`, `workspace_agent_policies`. Migrations geradas (table + RLS).

## Escopo (faz)
- Tabelas workspace-scoped (`workspace_id` + RLS por `app.workspace_id`): `agents`, `agent_tools`, `tool_logs`, `agent_executions`, `agent_metrics`, `llm_usage_logs`, `workspace_agent_policies`.
- Tabelas globais/plataforma (sem `workspace_id`, leitura para todos): `agent_templates`, `agent_template_questions`, `tools` (catálogo global), `llm_models_whitelist`.
- Índices de leitura (executions por agente+data, llm_usage por workspace+modelo+dia), FKs coerentes, CHECKs de enum (status, categoria de tool).
- Adicionar tudo ao barrel `schema/index.ts` (+ `RLS_TABLES`); gerar migration de tabela + migration custom de RLS (convenção dos slots de F1, ex. 0011_*_rls).

## Fora de escopo
- Lógica de runtime/policy enforcement (F2-S08), seeds (F2-S14/S15), API/UI.

## Arquivos permitidos
- `packages/db/src/schema/agents.ts`
- `packages/db/src/schema/agent_templates.ts`
- `packages/db/src/schema/agent_executions.ts`
- `packages/db/src/schema/agent_tools.ts`
- `packages/db/src/schema/llm.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`

## Definition of Done
- [ ] Todas as tabelas criadas com tipos/enums/índices conforme DATA_MODEL.
- [ ] RLS policy criada e testada nas tabelas com `workspace_id` (isolamento por `current_setting('app.workspace_id', true)::uuid`).
- [ ] Migrations de tabela + RLS geradas via drizzle-kit (sem editar journal à mão).
- [ ] `pnpm --filter @hm/db typecheck` verde.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas
Slot grande — se passar de ~500 linhas úteis, considere dividir o conjunto global (templates/tools/whitelist) do workspace-scoped (agents/executions/usage/policies) em dois slots sequenciais.
