---
id: F38-S01
title: Schema Help + Support (5 tabelas) + RLS + repos + seed
phase: F38
status: in-progress
priority: critical
estimated_size: L
depends_on: []
blocks:
  - F38-S02
  - F38-S03
  - F38-S07
source_docs:
  - docs/features/SUPPORT.md
agent_id: db-engineer
claimed_at: 2026-06-18T14:56:54Z

---
# F38-S01 — Schema Help + Support

## Objetivo

Camada de dados de toda a fase: tabelas de Central de Ajuda (platform-level) e de Chat de Suporte (workspace-scoped), com RLS correta, repos no barrel `@hm/db` e seed inicial. É a fundação — S02/S03 (help) e S07 (support) consomem. É o **único** slot de schema da fase (help + support juntos) para não colidir no `meta/_journal.json`.

## Contexto

Não há nada de help/support hoje. O padrão platform-level (sem `workspace_id`, sem RLS de tenant) é o de `packages/db/src/schema/platform_secrets.ts`. O padrão workspace-scoped + RLS é o das demais tabelas. `members.is_platform_admin` já existe.

## Escopo (faz)

- **`packages/db/src/schema/help.ts`** (novo) — `help_categories`, `help_articles`, `help_article_feedback` conforme SUPPORT.md §1.1. Help content é **platform-level** (sem `workspace_id`) → sem RLS de tenant em `help_categories`/`help_articles`. `help_article_feedback` **tem** `workspace_id` → RLS de tenant. FTS `tsvector` (config `portuguese`) sobre `title/excerpt/body_md` de `help_articles` + índice GIN.
- **`packages/db/src/schema/support.ts`** (novo) — `support_threads` (com `workspace_id`, RLS de tenant) + `support_messages` (herda escopo via `thread_id`) conforme §2.1.
- **`packages/db/drizzle/00XX_f38_help_support.sql`** + **`00YY_f38_help_support_rls.sql`** — DDL + policies (próximos números livres; entrada em `meta/_journal.json`). RLS: tenant em `help_article_feedback`, `support_threads`, `support_messages`; help content global-read.
- **`packages/db/src/repos/help.ts`** + **`packages/db/src/repos/support.ts`** (novos) — `helpRepo` (listPublishedCategories, getArticleBySlug, getArticleByAnchor, searchArticles(q), CRUD admin, upsertFeedback) e `supportRepo` (createThread, listThreadsForWorkspace, getThreadWithMessages, addMessage, setStatus, listAllThreads(filtros, platform)).
- **`packages/db/src/repos/index.ts`** + **`packages/db/src/index.ts`** — exportar `helpRepo`/`supportRepo` explicitamente (barrel raiz NÃO faz `export *` — gotcha F34).
- **`packages/db/src/schema/index.ts`** — registrar as novas tabelas.
- **`packages/db/src/seed.ts`** (se existir o ponto de seed; senão `packages/db/src/seeds/help.ts`) — 1 categoria + 2 artigos publicados de exemplo (em Leadium).
- **`packages/db/src/rls.test.ts`** — isolamento: workspace A não lê feedback/threads/messages de B; help content publicado é legível por qualquer tenant; platform bypass nos threads.

## Fora de escopo

- Rotas/serviços de API (S02/S03/S07). UI. Real-time (S08).

## Arquivos permitidos

- `packages/db/src/schema/help.ts`
- `packages/db/src/schema/support.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/repos/help.ts`
- `packages/db/src/repos/support.ts`
- `packages/db/src/repos/index.ts`
- `packages/db/src/index.ts`
- `packages/db/src/seed.ts`
- `packages/db/src/seeds/help.ts`
- `packages/db/drizzle/00XX_f38_help_support.sql`
- `packages/db/drizzle/00YY_f38_help_support_rls.sql`
- `packages/db/drizzle/meta/_journal.json`
- `packages/db/src/rls.test.ts`

## Arquivos proibidos

- `apps/**`
- `packages/db/src/schema/!(help|support|index).ts`

## Contratos de saída

- Tabelas `help_categories`, `help_articles`, `help_article_feedback`, `support_threads`, `support_messages`.
- `helpRepo` e `supportRepo` em `@hm/db` — consumidos por S02/S03/S07/S08/S10.

## Definition of Done

- [ ] Migration aplica limpo (Postgres dev); FTS GIN criado.
- [ ] RLS: help content global-read; feedback/threads/messages isolados por workspace; platform bypass testado.
- [ ] Repos exportam as funções; seed cria conteúdo de exemplo em Leadium.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/db test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas

FTS em `portuguese`. `help_articles.anchor_key` é a chave estável do help contextual (S06). Não restringir leitura de help content por role — qualquer membro autenticado lê publicados (o gate de leitura é na API, S03).
</content>
