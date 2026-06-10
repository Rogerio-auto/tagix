---
id: F4-S01
title: Schema Flow Builder (flows, flow_versions, flow_executions, flow_logs, flow_submissions) + RLS
phase: F4
status: in-progress
priority: critical
estimated_size: M
depends_on: []
agent_id: backend-engineer
claimed_at: 2026-06-10T19:52:42Z

---
# F4-S01 — Schema Flow Builder

> **source_docs:** `docs/DATA_MODEL.md` §9; `docs/features/FLOW_BUILDER.md` §2; `docs/ROADMAP.md` F4-S01
> **blocks:** F4-S02, F4-S08, F4-S13, F4-S14

## Objetivo
Modelar o domínio de Flow Builder em Drizzle + Postgres com RLS multi-tenant: `flows`, `flow_versions`, `flow_executions`, `flow_logs`, `flow_submissions`, conforme DATA_MODEL §9 (tipos/enums/índices exatos). Migrations geradas (tabela + RLS).

## Escopo (faz)
- `packages/db/src/schema/flows.ts`: as 5 tabelas com FKs (workspace/flow/version/conversation/contact/member/channel), CHECKs de enum (`status`, `trigger_type`, `triggered_by`, `level`), defaults jsonb (`nodes`/`edges`/`variables`/`trigger_config`), colunas de array (`filter_*`, `channel_ids`), `manual_position`.
- Índices de leitura do §9: `idx_flow_executions_status_next` (parcial `status='waiting' AND next_step_at IS NOT NULL` — hot-path do scheduler), `idx_flows_trigger_type` (parcial `status='active'`), demais b-tree.
- Barrel `schema/index.ts` (+ `RLS_TABLES`); migration de tabela + migration custom de RLS por `app.workspace_id`.

## Fora de escopo
- Engine/handlers (F4-S02+), API/UI, worker.

## Arquivos permitidos
- `packages/db/src/schema/flows.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`

## Contratos de saída
- Nomes de tabela/coluna são contrato (consumidos por `@hm/flow-engine`, API e worker). `flow_executions.flow_version_id` é `ON DELETE RESTRICT` (execução referencia a version, não o flow — §7 versionamento).

## Definition of Done
- [ ] 5 tabelas criadas conforme DATA_MODEL §9, com o índice parcial do scheduler.
- [ ] RLS criada e testada nas 5 tabelas (isolamento por `app.workspace_id`).
- [ ] Migrations geradas via drizzle-kit (RLS custom sem editar journal à mão).
- [ ] `pnpm --filter @hm/db typecheck` verde.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas
- Especialista sugerido: **db-engineer**.
- `nodes`/`edges` são `jsonb` (array de FlowNode/FlowEdge) — a forma forte é validada em runtime pelo `@hm/flow-engine` (F4-S02), não pelo Postgres.
