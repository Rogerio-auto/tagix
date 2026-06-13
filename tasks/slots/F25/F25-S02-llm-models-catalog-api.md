---
id: F25-S02
title: LLM models catalog API — CRUD llm_models_whitelist + sync OpenRouter /models
phase: F25
status: done
priority: high
estimated_size: M
depends_on: [F25-S01]
agent_id: backend-engineer
source_docs:
  - docs/ROADMAP.md#F2.5
  - docs/AGENTS_LANGGRAPH.md
claimed_at: 2026-06-13T01:24:15Z
completed_at: 2026-06-13T01:25:23Z

---
# F25-S02 — LLM models catalog API

> **source_docs:** `docs/ROADMAP.md` F2.5-S02; `docs/AGENTS_LANGGRAPH.md`
> **blocks:** F25-S07

## Objetivo

API de plataforma para gerenciar o catálogo global `llm_models_whitelist`: listar, ativar/desativar (`is_active`), editar `default_plan_keys`/notes, e **sincronizar com o OpenRouter** (`GET https://openrouter.ai/api/v1/models`) — upsert por `slug` com pricing/context/supports*, marcando `synced_at`. Gated por `requirePlatformAdmin`.

## Contexto

`llm_models_whitelist` é GLOBAL (sem workspace_id, fora de RLS) e já existe com colunas ricas (slug, display_name, upstream_provider, context_length, supports_tools/vision/streaming, pricing_*, default_plan_keys, synced_at). A chave OpenRouter mora em `platform_secrets`. A F2 já consome a whitelist; aqui é o CRUD + sync de super-admin.

## Escopo (faz)

- `apps/api/src/routes/platform/models.ts` (novo): `GET /platform/models` (lista), `PATCH /platform/models/:id` (is_active/default_plan_keys/notes), `POST /platform/models/sync` (puxa OpenRouter /models → upsert por slug). Todos com `requirePlatformAdmin` + Zod.
- `apps/api/src/services/platform/openrouter-models.ts` (novo): client OpenRouter `/models` (usa a key de `platform_secrets`, decifrada), mapeamento upstream→colunas, upsert idempotente.
- Teste (sync mockado + CRUD).

## Fora de escopo

- Guard (F25-S01). Frontend (F25-S07). Enforcement em runtime (já existe na F2).

## Arquivos permitidos

- `apps/api/src/routes/platform/models.ts`
- `apps/api/src/services/platform/openrouter-models.ts`
- `apps/api/src/routes/platform/models.test.ts`

## Arquivos proibidos

- `apps/api/src/app.ts` (wire é do orchestrator), outros `routes/platform/*` (S03-S05)

## Definition of Done

- [ ] CRUD da whitelist (list/patch) + sync OpenRouter (upsert por slug, synced_at, pricing/supports) funcionam; todos gated por platform-admin.
- [ ] Sync é idempotente (re-sync não duplica); key OpenRouter lida cifrada de `platform_secrets`, nunca logada.
- [ ] `pnpm --filter @hm/api test` (OpenRouter mockado) + lint/typecheck verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**.
- Exporta `createPlatformModelsRouter()` p/ o orchestrator montar em `app.ts`. Reusa crypto de `platform_secrets`.
