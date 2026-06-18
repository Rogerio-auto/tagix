---
id: F36-S11
title: Flow Builder mobile — inspecionar/operar (read-first)
phase: F36
status: in-progress
priority: medium
estimated_size: M
depends_on:
  - F36-S01
blocks:
  - F36-S14
source_docs:
  - docs/features/MOBILE_RESPONSIVE_PLAN.md
agent_id: frontend-engineer
claimed_at: 2026-06-18T02:01:32Z

---
# F36-S11 — Flow Builder mobile

## Objetivo

No celular, o Flow Builder vira **inspecionar/operar** (D1 — read-first), não desenhar: pan/zoom do grafo, lista de nodes, inspector como full-sheet, e ações de operar (publicar/despublicar/disparar). Edição estrutural fica melhor em `md+` (degradação honesta).

## Contexto

Canvas ReactFlow + inspector lateral — desenhar grafo no toque é ruim. Consome `Sheet`/`useBreakpoint` de S01.

## Escopo (faz)

- **`apps/web/features/flow-builder/**`** + **`apps/web/app/(app)/flows/**`** — `< md`:
  - Lista de flows usável (já é simples) + quickbar.
  - Editor: canvas read-first (pan/zoom, tocar node abre **inspector em full-sheet**); lista de nodes navegável; ações de lifecycle (publicar/despublicar/arquivar/disparar) acessíveis no rodapé.
  - Banner honesto: "Edição estrutural do grafo é melhor no desktop/tablet" quando aplicável.
  - `md+`: editor atual intacto (zero regressão).

## Fora de escopo

- Edição estrutural completa por toque (drag de nodes/edges no mobile). Mudança da engine/handlers.

## Arquivos permitidos

- `apps/web/features/flow-builder/**`
- `apps/web/app/(app)/flows/**`

## Arquivos proibidos

- `apps/api/**`, `packages/flow-engine/**`

## Definition of Done

- [ ] `< md`: navegar/inspecionar o flow (pan/zoom + inspector full-sheet) e operar lifecycle; sem travar.
- [ ] Banner de degradação honesto quando a edição estrutural não é ideal no toque.
- [ ] `md+`: editor inalterado.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- §2.1 tocar node = selecionar + inspector (não engrenagem); §2.3 inspector→full-sheet; §2.11 erro/limite com mensagem clara (banner de degradação).

## Notas

ReactFlow tem suporte a touch pan/zoom — habilitar e desabilitar a edição de grafo (`nodesDraggable`/`elementsSelectable`) por breakpoint. Inspectors já existem (F31) — trocar container pra sheet no mobile.
