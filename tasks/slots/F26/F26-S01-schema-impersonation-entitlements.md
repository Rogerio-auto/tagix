---
id: F26-S01
title: Schema — impersonation_sessions + workspace_entitlement_overrides + llm_usage_logs.is_test
phase: F26
status: review
priority: critical
estimated_size: M
depends_on: []
agent_id: db-engineer
source_docs:
  - docs/features/PLATFORM_TENANT_MANAGEMENT.md
  - docs/DATA_MODEL.md
claimed_at: 2026-06-13T14:28:35Z
completed_at: 2026-06-13T14:32:19Z

---
# F26-S01 — Schema da F26 (db)

> **source_docs:** `docs/features/PLATFORM_TENANT_MANAGEMENT.md` §5.3/§6.1/§7.1
> **blocks:** F26-S04, F26-S05, F26-S06

## Objetivo

Criar as tabelas/colunas novas da fase: `impersonation_sessions` (view-as auditada), `workspace_entitlement_overrides` (override de limites/features não-IA por tenant) e a coluna `llm_usage_logs.is_test` (custo de playground separado de produção). Migration versionada + RLS onde for workspace-scoped + repos.

## Contexto

Billing schema (plans/subscriptions/workspaces.subscription_status) e AI governance (workspace_agent_policies/llm_usage_logs) já existem. Faltam só estas 3 peças. `is_test` separa o gasto do sandbox (F26-S06) do billing real.

## Escopo (faz)

- `packages/db/src/schema/impersonation.ts` (novo): `impersonation_sessions` (id, admin_member_id, target_workspace_id, mode `view` (só view-as read-only nesta fase), reason, started_at, expires_at, ended_at, ip, user_agent). **Platform-level** (gerida só por super-admin; como `platform_secrets`, sem RLS de tenant — documentar) + índices (ativas por expires_at).
- `packages/db/src/schema/entitlements.ts` (novo): `workspace_entitlement_overrides` (workspace_id PK/FK, `limits` jsonb, `features` jsonb, updated_by, updated_at). **Workspace-scoped → RLS + RLS_TABLES**.
- `packages/db/src/schema/llm.ts` (editar): `is_test boolean not null default false` em `llm_usage_logs` + índice parcial.
- `packages/db/src/schema/index.ts` (editar): exports + registrar `workspace_entitlement_overrides` em `RLS_TABLES` (impersonation_sessions é platform-level → NÃO entra).
- Migration versionada (`drizzle-kit generate` + bloco RLS manual) + `packages/db/src/repos/{impersonation,entitlements}.ts` + `rls.test.ts` (cross-tenant nega override).

## Fora de escopo

- APIs/UI (outros slots). act-as/escrita na impersonation (fase futura — só `view` agora).

## Arquivos permitidos

- `packages/db/src/schema/impersonation.ts`
- `packages/db/src/schema/entitlements.ts`
- `packages/db/src/schema/llm.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/repos/impersonation.ts`
- `packages/db/src/repos/entitlements.ts`
- `packages/db/drizzle/**`
- `packages/db/src/index.ts`
- `packages/db/src/rls.test.ts`

## Definition of Done

- [ ] 3 mudanças aplicadas (2 tabelas + coluna), migration versionada; `workspace_entitlement_overrides` com RLS testada (cross-tenant nega); `impersonation_sessions` platform-level documentada.
- [ ] `pnpm --filter @hm/db typecheck` + lint + `pnpm --filter @hm/db test` (incl. nova RLS) + `migrate` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas

- Especialista: **db-engineer**. `mode` aceita só `'view'` agora (CHECK), mas modela o enum p/ futuro act. Aplicar migration no Postgres dev. Exporta repos p/ os slots backend.
