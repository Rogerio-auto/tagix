---
id: F38-S04
title: UI CMS Help no (platform) — lista + editor MD + publish
phase: F38
status: in-progress
priority: high
estimated_size: M
depends_on:
  - F38-S02
blocks: []
source_docs:
  - docs/features/SUPPORT.md
agent_id: frontend-engineer
claimed_at: 2026-06-18T17:01:19Z

---
# F38-S04 — UI CMS Help (platform)

## Objetivo

Painel super-admin para escrever/gerir conteúdo de ajuda: lista de categorias/artigos, editor Markdown com preview sanitizado e workflow draft→published. Consome a API do S02.

## Contexto

Área `(platform)` em `apps/web/app/(platform)/platform/*`, features em `apps/web/features/platform-admin/*` (1 pasta por domínio). DS v2 nativo, zero hex em JSX. TanStack Query para remote.

## Escopo (faz)

- **`apps/web/app/(platform)/platform/help/page.tsx`** (novo) — rota do CMS.
- **`apps/web/features/platform-admin/help/**`** (novo) — lista (categorias + artigos, reorder drag), editor de artigo (título, slug, excerpt, categoria, anchor_key, corpo Markdown com preview ao vivo **sanitizado**), ações publish/unpublish, estados loading/error/empty, queries.
- **`apps/web/features/platform-admin/shell/*`** — adicionar item "Ajuda" na nav do painel platform (somente o registro de nav).

## Fora de escopo

- Leitor `/help` (S05). API (S02). Markdown render lib pode ser compartilhada com S05 — usar `@hm/ui` se já houver render; senão criar local sanitizado e S05 reusa.

## Arquivos permitidos

- `apps/web/app/(platform)/platform/help/page.tsx`
- `apps/web/features/platform-admin/help/**`
- `apps/web/features/platform-admin/shell/**`

## Arquivos proibidos

- `apps/web/features/help/**`, `apps/web/app/(app)/**`, `apps/api/**`, `packages/db/**`

## Definition of Done

- [ ] CRUD de categorias/artigos pela UI; reorder; publish/unpublish refletem.
- [ ] Editor com preview Markdown **sanitizado** (sem HTML perigoso).
- [ ] DS v2 tokens; estados default/loading/error/empty; ARIA em controles.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Notas

Branding "Leadium" nos textos. O preview deve usar exatamente o mesmo sanitizador do leitor (S05) para evitar divergência — extrair para util reusável se preciso.
</content>
