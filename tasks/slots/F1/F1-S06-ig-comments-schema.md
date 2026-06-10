---
id: F1-S06
title: Schema ig_comments (auxiliar Instagram)
phase: F1
status: done
priority: low
estimated_size: S
depends_on: [F1-S05]
agent_id: backend-engineer
claimed_at: 2026-06-10T00:05:51Z
completed_at: 2026-06-10T00:05:51Z

---
# F1-S06 — Schema ig_comments

> **source_docs:** `docs/features/INSTAGRAM.md`; `docs/DATA_MODEL.md`
> **blocks:** F1.5 (comments)

## Objetivo
Tabela auxiliar `ig_comments` (vazia no MVP, populada em F1.5) para comment threads do Instagram.

## Escopo (faz)
- `packages/db/src/schema/ig_comments.ts` — media_id, comment_id, parent_comment_id, from_igsid, text, etc. + RLS (workspace_id) + migration.

## Arquivos permitidos
- `packages/db/src/schema/ig_comments.ts`, `packages/db/src/schema/index.ts`, `packages/db/drizzle/**`

## Definition of Done
- [ ] Tabela + RLS + migration; typecheck/lint/migrate limpos.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db migrate
```

## Notas
Schema-ready no MVP; lógica de comments é F1.5 (vide INSTAGRAM.md).
