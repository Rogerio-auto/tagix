---
id: F43-S01
title: Schema — quick_replies + estado de onboarding/tour + RLS + repos
phase: F43
status: done
priority: critical
estimated_size: M
depends_on: []
blocks: [F43-S02, F43-S03, F43-S04, F43-S07]
agent_id: db-engineer
source_docs:
  - docs/features/ONBOARDING.md
claimed_at: 2026-06-19T20:37:09Z
completed_at: 2026-06-19T20:45:49Z

---
# F43-S01 — Schema foundation (onboarding & verticalização)

> **source_docs:** `docs/features/ONBOARDING.md` §2.1, §3.1, §5
> **blocks:** F43-S02, F43-S03, F43-S04, F43-S07

## Objetivo

Criar a tabela `quick_replies` (workspace-scoped) e o estado de onboarding/tour
(`workspaces.onboarding` + `members.tour_state`), com migrations versionadas, RLS e repos —
fundação para o instanciador de blueprint e o first-run.

## Contexto

Respostas rápidas não existem como schema (necessárias para o preset de departamentos/atendimento).
O sistema não tem flag de first-run — `workspaces`/`members` ganham colunas jsonb dedicadas.

## Escopo (faz)

- Tabela **`quick_replies`**: `id uuid pk`, `workspace_id uuid` (FK cascade, NOT NULL),
  `department_id uuid` (FK `org.departments`, nullable — resposta global do workspace quando null),
  `title text`, `body text`, `position int default 0`, `created_by uuid` (FK members, set null),
  `created_at`, `updated_at`. UNIQUE `(workspace_id, title)`. Índices por `workspace_id` e `department_id`.
- Coluna **`onboarding jsonb NOT NULL DEFAULT '{}'`** em `workspaces` — shape `{ niche_key, applied_at, survey, setup_completed }` (tipado via `$type`).
- Coluna **`tour_state jsonb NOT NULL DEFAULT '{}'`** em `members` — shape `{ [tourId]: { completed_at, dismissed } }`.
- Migrations: `0047_f43_onboarding.sql` (tabela + colunas) e `0048_f43_onboarding_rls.sql` (RLS de `quick_replies`).
- RLS de `quick_replies`: isolamento por `app.workspace_id` (padrão do projeto). `onboarding`/`tour_state` herdam o RLS já existente de `workspaces`/`members`.
- Repos: `packages/db/src/repos/quick-replies.ts` (CRUD + listByWorkspace/byDepartment) e helpers de leitura/escrita do estado de onboarding (`repos/onboarding.ts`: get/setWorkspaceOnboarding, get/setMemberTourState).

## Fora de escopo

- Instanciador de blueprint (F43-S02). API (F43-S04). UI (F43-S05/S06).

## Arquivos permitidos

- `packages/db/src/schema/quick_replies.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/repos/quick-replies.ts`
- `packages/db/src/repos/onboarding.ts`
- `packages/db/src/repos/index.ts`
- `packages/db/drizzle/0047_f43_onboarding.sql`
- `packages/db/drizzle/0048_f43_onboarding_rls.sql`
- `packages/db/drizzle/meta/**`
- `packages/db/src/rls.test.ts`

## Arquivos proibidos

- `apps/**`, `packages/db/src/seed/**`

## Contratos de saída

- `quickReplies` schema export + tipos `$inferInsert/$inferSelect`.
- `workspaces.onboarding` e `members.tourState` tipados.
- Repos exportados em `repos/index.ts`.

## Definition of Done

- [ ] `quick_replies` criada; colunas `onboarding`/`tour_state` adicionadas; migrations aplicam limpo.
- [ ] RLS policy criada e **testada** para `quick_replies` (isolamento por workspace) em `rls.test.ts`.
- [ ] Repos idempotentes (upsert de quick_reply por `workspace_id+title` não duplica).
- [ ] `pnpm --filter @hm/db test` + `pnpm typecheck` + `pnpm lint` verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas

- Especialista: **db-engineer**. Próximas migrations livres = `0047`, `0048` (última = `0046_f41_payments`).
- `workspaces.onboarding` é coluna dedicada (não dentro de `settings`) para query/observabilidade clara.
