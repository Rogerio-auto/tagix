---
id: F0-S04
title: RLS policies multi-tenant + teste de isolamento
phase: F0
status: in-progress
priority: critical
estimated_size: S
depends_on: [F0-S03]
agent_id: backend-engineer
claimed_at: 2026-06-09T14:58:18Z

---
# F0-S04 — RLS policies (isolamento multi-tenant)

> **source_docs:** `docs/DATA_MODEL.md` §3.4 (RLS sample), §1; `docs/ARCHITECTURE.md` §"RLS"
> **blocks:** F0-S06 (withRLS middleware)

## Objetivo

Habilitar Row Level Security em todas as tabelas com `workspace_id` e provar, por teste de integração, que um workspace não lê dados de outro.

## Escopo (faz)

- Migration de RLS: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + policy de isolamento `USING (workspace_id = current_setting('app.workspace_id', true)::uuid)` para workspaces/members/subscriptions/audit_logs (e api_keys). Workspaces isola por `id`.
- Helper `withWorkspace(workspaceId, fn)` em `@hm/db` que faz `SET LOCAL app.workspace_id` numa transação.
- Teste de integração (vitest) que cria 2 workspaces e confirma que a query escopada só vê o próprio.
- **Regra para fases futuras:** todo slot de schema novo (F1+) inclui RLS no mesmo PR (item de DoD).

## Arquivos permitidos

- `packages/db/**`

## Definition of Done

- [ ] RLS habilitada nas tabelas com `workspace_id`.
- [ ] `withWorkspace()` seta `app.workspace_id` por transação.
- [ ] Teste de isolamento passa (workspace B não enxerga dados de A).
- [ ] `pnpm typecheck`, `pnpm lint` limpos.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db migrate
pnpm --filter @hm/db test
```

## Notas

- O role da app conecta sem BYPASSRLS. Migrations rodam como superuser/owner (que bypassa) — o teste valida via role/sessão com `SET app.workspace_id`. Documentar a estratégia de role no `@hm/db`.
