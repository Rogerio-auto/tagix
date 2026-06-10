---
id: F5-S01
title: Schema tags + contact_tags + RLS (destrava conversões e add_tag/remove_tag da F4)
phase: F5
status: in-progress
priority: critical
estimated_size: S
depends_on: []
agent_id: backend-engineer
claimed_at: 2026-06-10T21:43:37Z

---
# F5-S01 — Schema tags + contact_tags

> **source_docs:** `docs/DATA_MODEL.md` §5.2; `docs/ROADMAP.md` F5 (pré-requisito de conversões e dos stubs F4)
> **blocks:** F5-S03, F5-S14, F5-S16

## Objetivo
Criar `tags` e `contact_tags` (DATA_MODEL §5.2) — especificadas mas nunca implementadas (F1-S05 não as criou). Destrava: `conversion_tag_triggers` (F5-S03), os handlers `add_tag`/`remove_tag` e o trigger `tag_added` da F4 (F5-S16).

## Escopo (faz)
- `packages/db/src/schema/tags.ts`: `tags` (workspace-scoped, UNIQUE(workspace_id,name)) + `contact_tags` (PK composta contact_id+tag_id, `tagged_by`, `tagged_at`).
- **RLS:** `contact_tags` não tem `workspace_id` no §5.2 — denormalize uma coluna `workspace_id` (NOT NULL, FK) para RLS direta por `app.workspace_id`, coerente com o padrão do projeto (alternativa via subquery é mais lenta no hot-path de tagging).
- Barrel `schema/index.ts` (+ `RLS_TABLES`); migration de tabela + RLS.

## Fora de escopo
- UI de gestão de tags (F8 settings), aplicação de tags por flow (F5-S16).

## Arquivos permitidos
- `packages/db/src/schema/tags.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`

## Definition of Done
- [ ] `tags` + `contact_tags` criadas conforme §5.2 (+ `workspace_id` denormalizado em contact_tags p/ RLS).
- [ ] RLS criada e testada nas 2 tabelas (isolamento por `app.workspace_id`).
- [ ] `pnpm --filter @hm/db test` + typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas
- Especialista sugerido: **db-engineer**.
- Slot pequeno mas de alta alavancagem (desbloqueia 3 outros). `contact_tags.workspace_id` deve casar com `contacts.workspace_id` na escrita.
