---
id: F56-S27
title: DS — Drawer canônico + IconButton (foco de teclado)
phase: F56
status: done
priority: medium
estimated_size: M
depends_on: [F56-S26]
blocks: []
agent_id: frontend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
completed_at: 2026-07-17T23:51:12Z

---
# F56-S27 — Drawer canônico + IconButton (DS-02/DS-05)

> **Origem:** AUDITORIA_TECNICA.md §3.9. Sem Drawer canônico há 3 padrões + 2 `Sheet.tsx` homônimos; 34 arquivos têm `<button>` cru sem foco de teclado.

## Objetivo

Prover um `Drawer` responsivo com focus-trap único e um `IconButton` acessível no DS, base para eliminar os drawers hand-rolled e o foco de teclado ausente.

## Contexto / causa raiz (verificada)

`apps/web/shared/components/help/Sheet.tsx` e `.../Sheet/Sheet.tsx` (homônimos); `DealDetailDrawer.tsx:68` monta backdrop à mão sem focus-trap; 282 `<button>` crus, 34 arquivos sem `focus-visible`.

## Escopo (faz)

- `Drawer` em `@hm/ui` com `side="right|bottom"` responsivo (colapsa para bottom-sheet no mobile), focus-trap único, Esc/backdrop consistentes; stories Ladle.
- `IconButton` (variantes ghost/link) com `focus-visible` do DS; stories Ladle.

## Escopo (não faz)

- Migrar os 7 `*Drawer` e os 34 `<button>` (sweep de adoção — follow-up).
- Barrel export (F56-S26 é dono de `index.ts`).

## Arquivos permitidos

- `packages/ui/src/Drawer/**`
- `packages/ui/src/IconButton/**`

## Arquivos proibidos

- `packages/ui/src/index.ts` (F56-S26) · `apps/web/**`

## Definition of Done

- [ ] `Drawer` com focus-trap, responsivo, testado (a11y).
- [ ] `IconButton` com foco de teclado visível.
- [ ] Stories Ladle; `pnpm --filter @hm/ui ladle:build` verde.
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## UX considerations (docs/UX_PRINCIPLES.md)

- Focus-trap e navegação por teclado (a11y) no overlay.
- Um único padrão de drawer (evitar os homônimos/hand-rolled).
- `focus-visible` em toda ação-ícone.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/ui ladle:build
```

## Notas

- **Depende de F56-S26** por causa do barrel `index.ts`. Os componentes aqui são disjuntos (subdirs próprios); só o export compartilha arquivo.
