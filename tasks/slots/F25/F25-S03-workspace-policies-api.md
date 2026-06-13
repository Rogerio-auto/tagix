---
id: F25-S03
title: Workspace agent policies API — editor por workspace (allowed_models, features, caps)
phase: F25
status: in-progress
priority: high
estimated_size: M
depends_on: [F25-S01]
agent_id: backend-engineer
source_docs:
  - docs/ROADMAP.md#F2.5
  - docs/AGENTS_LANGGRAPH.md
claimed_at: 2026-06-13T01:25:30Z

---
# F25-S03 — Workspace agent policies API

> **source_docs:** `docs/ROADMAP.md` F2.5-S03; `docs/AGENTS_LANGGRAPH.md`
> **blocks:** F25-S07

## Objetivo

API de plataforma para o super-admin editar a `workspace_agent_policies` de qualquer workspace: ler e atualizar `allowed_models`, `default_chat_model`, as flags LangGraph (allow_streaming/interrupts/parallel_tools/vision/transcription/persistent_checkpoints/agent_conversions), os caps (max_iterations/tools/tokens/monthly_cost/daily_invocations) e `allowed_tool_categories`. Gated por `requirePlatformAdmin`.

## Contexto

`workspace_agent_policies` (PK = workspace_id, 1:1) já existe com todas as colunas. A F2 já valida agents contra ela em runtime. Aqui o super-admin define, por workspace, o que pode usar — sem mexer em código (entregável da F2.5). Como é acesso cross-workspace pela plataforma, NÃO usa RLS de tenant (o guard é a fronteira); as queries setam o workspace alvo explicitamente.

## Escopo (faz)

- `apps/api/src/routes/platform/policies.ts` (novo): `GET /platform/workspaces/:workspaceId/agent-policy` (lê, cria default se ausente), `PUT /platform/workspaces/:workspaceId/agent-policy` (atualiza campos validados; `updated_by` = admin). `GET /platform/workspaces` (lista p/ o seletor). `requirePlatformAdmin` + Zod (valida allowed_models ⊆ whitelist ativa; caps ≥ 0).
- Teste (update + validação de modelos contra whitelist).

## Fora de escopo

- Guard (F25-S01). Catálogo (F25-S02). Frontend (F25-S07). Enforcement (F2).

## Arquivos permitidos

- `apps/api/src/routes/platform/policies.ts`
- `apps/api/src/routes/platform/policies.test.ts`

## Arquivos proibidos

- `apps/api/src/app.ts`, outros `routes/platform/*` (S02/S04/S05)

## Definition of Done

- [ ] GET/PUT da policy por workspace funcionam (cria default no GET se ausente); `updated_by` registrado; mudança em `audit_logs`.
- [ ] Validação: `allowed_models` só aceita slugs da whitelist ativa; caps não-negativos; `default_chat_model` ∈ allowed.
- [ ] `pnpm --filter @hm/api test` + lint/typecheck verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**.
- Exporta `createPlatformPoliciesRouter()` p/ o orchestrator wire. Cross-workspace → setar workspace alvo na query explicitamente (sem `withWorkspace` de sessão).
