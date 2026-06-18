---
id: F38-S05
title: UI leitor /help + entrada de nav "Ajuda"
phase: F38
status: done
priority: high
estimated_size: M
depends_on:
  - F38-S03
blocks:
  - F38-S06
source_docs:
  - docs/features/SUPPORT.md
agent_id: frontend-engineer
claimed_at: 2026-06-18T17:14:04Z
completed_at: 2026-06-18T17:17:41Z

---
# F38-S05 — UI leitor /help

## Objetivo

Central de Ajuda para o membro do workspace: home com categorias, busca, view de artigo (render Markdown sanitizado) e feedback "isso ajudou?". Nova entrada de nav "Ajuda". Consome a API do S03.

## Contexto

Nav em `apps/web/shared/components/layout/nav.ts` (itens com `href`/`label`/`icon`/`perm` opcional). Rotas `(app)` em `apps/web/app/(app)/*`. DS v2, responsivo (a fase F36 entregou `Sheet`/`useBreakpoint`/primitivos — reusar).

## Escopo (faz)

- **`apps/web/app/(app)/help/page.tsx`** + **`apps/web/app/(app)/help/[slug]/page.tsx`** (novos) — home + artigo.
- **`apps/web/features/help/**`** (novo) — home (categorias + busca), lista por categoria, view de artigo (render **sanitizado**), widget de feedback (helpful + comentário opcional), queries. Estados loading/error/empty; busca com debounce.
- **`apps/web/shared/components/layout/nav.ts`** — adicionar `{ href: '/help', label: 'Ajuda', icon: <lucide> }` (sem `perm` — visível a todos).

## Fora de escopo

- Help contextual `(?)` (S06). Chat de suporte (S09 — mas o launcher "Falar com suporte" será montado aqui em S09; deixar um slot/placeholder de layout previsível). CMS (S04). API (S03).

## Arquivos permitidos

- `apps/web/app/(app)/help/**`
- `apps/web/features/help/**`
- `apps/web/shared/components/layout/nav.ts`

## Arquivos proibidos

- `apps/web/features/support/**`, `apps/api/**`, `packages/db/**`

## Definition of Done

- [ ] Home lista categorias; busca FTS funciona; artigo renderiza Markdown sanitizado.
- [ ] Feedback envia e dá confirmação; só conteúdo publicado aparece.
- [ ] Responsivo (< md usa sheet/layout mobile); DS v2 tokens; ARIA.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Notas

Render sanitizado compartilhado com S04 (mesmo util). Branding "Leadium".
</content>
