---
id: F26-S02
title: Workspaces API — list de tenants + Workspace 360 agregado
phase: F26
status: review
priority: high
estimated_size: M
depends_on: []
agent_id: backend-engineer
source_docs:
  - docs/features/PLATFORM_TENANT_MANAGEMENT.md
claimed_at: 2026-06-13T14:32:34Z
completed_at: 2026-06-13T14:42:04Z

---
# F26-S02 — Workspaces / 360 API

> **source_docs:** `docs/features/PLATFORM_TENANT_MANAGEMENT.md` §4
> **blocks:** F26-S07

## Objetivo

API de plataforma para o hub de tenants: `GET /platform/workspaces` (lista paginável/buscável com plano, status, #membros, uso-mês, saúde) e `GET /platform/workspaces/:id` (Workspace 360 agregado: resumo+plano+status, uso/custo via rollup, membros, canais (metadados), agentes+policy, saúde, audit recente). Gated por `requirePlatformAdmin`.

## Contexto

Tudo cross-workspace, lido como owner (sem RLS de sessão) — o guard (F25-S01) é a fronteira. Reusa o rollup de uso da F25-S05. **Sem schema novo** (lê tabelas existentes).

## Escopo (faz)

- `apps/api/src/routes/platform/workspaces.ts` (novo): list + 360 (Zod nos query params, paginação).
- `apps/api/src/services/platform/workspace-360.ts` (novo): agregações (membros/canais/agentes/saúde/uso) — queries owner eficientes.
- Teste (list + 360 com seed; secrets/tokens NUNCA serializados).

## Fora de escopo

- Assinatura/plano edit (F26-S04). UI (F26-S07). Guard (F25-S01, existe).

## Arquivos permitidos

- `apps/api/src/routes/platform/workspaces.ts`
- `apps/api/src/services/platform/workspace-360.ts`
- `apps/api/src/routes/platform/workspaces.test.ts`

## Arquivos proibidos

- `apps/api/src/app.ts` (wire é do orchestrator), outros `routes/platform/*`

## Definition of Done

- [ ] List com filtros/paginação + 360 agregado corretos; **nenhum secret/token de canal** na resposta (só metadados).
- [ ] Gated por platform-admin; queries cross-workspace como owner.
- [ ] `pnpm --filter @hm/api test` + lint/typecheck verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**. Exporta `createPlatformWorkspacesRouter()` p/ o orchestrator wire. Reusa o rollup da F25-S05 (não reimplementar).
