---
id: F36-S04
title: Pipeline/kanban responsivo — seletor de estágio + lista
phase: F36
status: in-progress
priority: high
estimated_size: M
depends_on:
  - F36-S01
blocks:
  - F36-S14
source_docs:
  - docs/features/MOBILE_RESPONSIVE_PLAN.md
agent_id: frontend-engineer
claimed_at: 2026-06-16T20:22:26Z

---
# F36-S04 — Kanban responsivo

## Objetivo

Tornar o pipeline (kanban horizontal) usável no celular: seletor de estágio (chips/segmented) + lista vertical de cards do estágio selecionado, com mover-deal por toque e detalhe em sheet.

## Contexto

O board é colunas horizontais com scroll-x e drag — inviável no toque. Consome `useBreakpoint`/`Sheet` de S01.

## Escopo (faz)

- **`apps/web/features/pipeline/**`** + **`apps/web/app/(app)/pipeline/page.tsx`** — em `< md`:
  - Barra de estágios rolável (chips com contagem) seleciona o estágio ativo; abaixo, lista vertical dos deals daquele estágio (cards: título, valor, dono, contato).
  - Mover deal: ação por toque (menu "Mover para…" ou setas), não drag-and-drop fino. Detalhe do deal abre em `Sheet`.
  - `md+`: kanban atual intacto (zero regressão).

## Fora de escopo

- Mudança de API de deals/stages. Pipeline settings (S10? não — settings de pipeline fica aqui? Não: `/pipeline/settings` é form → tratado em S10/escopo de settings). Aqui só o board `/pipeline`.

## Arquivos permitidos

- `apps/web/features/pipeline/board/**`
- `apps/web/app/(app)/pipeline/page.tsx`

## Arquivos proibidos

- `apps/web/features/pipeline/settings/**` (tela de settings; outra entrega)
- `apps/api/**`, `packages/**`

## Definition of Done

- [ ] `< md`: seletor de estágio + lista vertical; mover deal por toque funciona; detalhe em sheet.
- [ ] `md+`: kanban inalterado.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- §2.1 ação primária = tocar o card (abre detalhe); §4 plano: gesto com equivalente de toque (mover por menu).
- §2.3 detalhe em sheet; §2.7 feedback ao mover.

## Notas

Se o board usa dnd-kit, manter o DnD só no `md+`; no mobile usar ação explícita de mover (evita o anti-padrão drag-arrasta-tudo §2.2 no toque).
