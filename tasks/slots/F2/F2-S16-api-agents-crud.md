---
id: F2-S16
title: API CRUD agents + tools_global + toggle agent_tools (Node)
phase: F2
status: in-progress
priority: high
estimated_size: M
depends_on: [F2-S01, F2-S03]
agent_id: backend-engineer
claimed_at: 2026-06-10T03:33:47Z

---
# F2-S16 — API CRUD de agentes

> **source_docs:** `docs/AGENTS_LANGGRAPH.md` §6; `docs/features/PERMISSIONS.md`; `docs/ROADMAP.md` F2-S16
> **blocks:** F2-S17, F2-S18, F2-S19

## Objetivo
Endpoints REST para gerenciar agentes: CRUD de `agents` (criar a partir de template, editar config/modelo/prompt, ativar/desativar), listagem do catálogo global `tools`, e toggle de `agent_tools` (habilitar/desabilitar tool por agente) — tudo RLS + role-gated.

## Escopo (faz)
- `apps/api/src/routes/agents/index.ts`: `createAgentsRouter()` agregando os sub-routers.
- `apps/api/src/routes/agents/crud.ts`: list/create/get/update/disable de `agents` (Zod, `req.scoped` RLS, role `agent.manage`).
- `apps/api/src/routes/agents/tools.ts`: list `tools` global + GET/PUT `agent_tools` toggle.

## Fora de escopo
- Playground/SSE (F2-S19, dono de `routes/agents/playground.ts`), cost-guard (F2-S09, `apps/api/src/agents/**`), UI (F2-S17/S18).

## Arquivos permitidos
- `apps/api/src/routes/agents/index.ts`
- `apps/api/src/routes/agents/crud.ts`
- `apps/api/src/routes/agents/tools.ts`

## Definition of Done
- [ ] CRUD completo sob RLS; criar-a-partir-de-template materializa config + agent_tools default.
- [ ] Role gating (`agent.manage`/`agent.view`) por endpoint; Zod em toda input.
- [ ] `pnpm --filter @hm/api typecheck`/lint/test verdes.

## Permission scope
- `agent.manage` (ADMINS) para create/update/disable; `agent.view` (STAFF) para list/get. Conferir/estender `docs/features/PERMISSIONS.md §2`.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
Router montado em `app.ts` pelo orchestrator (fora do files_allowed). Não montar `playground.ts` aqui (F2-S19).
