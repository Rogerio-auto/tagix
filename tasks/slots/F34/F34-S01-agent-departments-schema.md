---
id: F34-S01
title: Schema agent_departments (N:N agente↔departamento) + RLS + repo
phase: F34
status: done
priority: critical
estimated_size: S
depends_on: []
blocks:
  - F34-S02
  - F34-S03
  - F34-S04
  - F34-S05
source_docs:
  - docs/features/AGENT_DEPARTMENT_ROUTING_PLAN.md
agent_id: db-engineer
claimed_at: 2026-06-16T02:54:14Z
completed_at: 2026-06-16T03:00:45Z

---
# F34-S01 — Schema agent_departments

## Objetivo

Criar o vínculo **N:N** entre agentes de IA e departamentos: tabela `agent_departments` com flag `is_default` (agente de entrada por departamento), RLS multi-tenant e um repo com as queries que o resto da F34 consome.

## Contexto

`agents` (packages/db/src/schema/agents.ts) hoje não tem nenhuma referência a departamento; `departments` existe desde a F8 (packages/db/src/schema/org.ts). Esta é a fundação — **S02/S03/S04/S05 dependem dela**. Decisão travada: N:N (um agente atende vários departamentos); `is_default` designa o agente de entrada **por departamento** (D2).

## Escopo (faz)

- **`packages/db/src/schema/agent_departments.ts`** (novo) — tabela:
  - `agentId` → `agents.id` (cascade), `departmentId` → `departments.id` (cascade), `workspaceId` → `workspaces.id` (cascade, denormalizado p/ RLS direta, padrão `team_members`/`contact_tags`).
  - `isDefault boolean not null default false` — agente de entrada daquele departamento.
  - `createdAt`. PK composta `(agentId, departmentId)`.
  - Índices: `idx_agent_departments_department` (department), `idx_agent_departments_workspace`. **Índice parcial único** `uq_agent_departments_one_default_per_dept` em `(departmentId)` `where is_default` → no máximo 1 default por departamento.
- **`packages/db/src/schema/index.ts`** — exportar a nova tabela.
- **`packages/db/drizzle/0041_f34_agent_departments.sql`** (novo) — DDL da tabela + índices.
- **`packages/db/drizzle/0042_f34_agent_departments_rls.sql`** (novo) — `ENABLE ROW LEVEL SECURITY` + policy por `workspace_id` (espelha o padrão das demais tabelas com workspace_id).
- **`packages/db/src/repos/agent_departments.ts`** (novo) — funções escopadas por RLS (`withWorkspace`/`tx`):
  - `listDepartmentsForAgent(agentId)` → department_ids + isDefault.
  - `listAgentsForDepartment(departmentId)` → agent_ids + isDefault.
  - `getDefaultAgentForDepartment(departmentId)` → agentId | null.
  - `setAgentDepartments(agentId, items: { departmentId, isDefault }[])` → replace-all transacional (delete + insert), garantindo no máx. 1 default por dept.
  - `areAgentsInSameDepartment(agentIdA, agentIdB)` → boolean (usado pela authz de transferência da S05).
- **`packages/db/src/repos/index.ts`** — re-exportar o repo.
- **`packages/db/src/rls.test.ts`** — teste de isolamento da nova tabela (tenant A não vê linhas de B).

## Fora de escopo

- Resolução do agente por departamento (S03 — `apps/workers`).
- Qualquer UI ou rota de API (S02/S04).
- FK de `conversations.department_id` (já existe; não tocar `conversations.ts`).

## Arquivos permitidos

- `packages/db/src/schema/agent_departments.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/repos/agent_departments.ts`
- `packages/db/src/repos/index.ts`
- `packages/db/drizzle/0041_f34_agent_departments.sql`
- `packages/db/drizzle/0042_f34_agent_departments_rls.sql`
- `packages/db/src/rls.test.ts`

## Arquivos proibidos

- `packages/db/src/schema/agents.ts`
- `packages/db/src/schema/conversations.ts`
- `packages/db/src/schema/org.ts`
- `apps/**`

## Contratos de saída

- Tabela `agent_departments(agent_id, department_id, workspace_id, is_default, created_at)`.
- Repo `@hm/db` com as funções acima — consumido por S02 (config), S03 (resolução), S05 (authz de transferência).

## Definition of Done

- [ ] Tabela criada com PK composta + índice parcial único de `is_default` por departamento.
- [ ] Migration de schema + migration de RLS aplicam limpo no Postgres dev (`pnpm --filter @hm/db migrate` ou equivalente).
- [ ] RLS policy criada e testada (tenant A não enxerga linhas de B).
- [ ] Repo exporta as 5 funções; `setAgentDepartments` é replace-all transacional e idempotente.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/db test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas

Seguir o padrão de denormalização de `workspace_id` em join tables (`team_members`, `contact_tags`) — casar `agent_departments.workspace_id` com `agents.workspace_id` e `departments.workspace_id` na escrita. O índice parcial único é o que garante D2 (1 agente de entrada por dept) no nível do banco — não confiar só na app.
