---
id: F10-S12
title: a11y das telas flagship — ChatList (setas), Pipeline (dnd-kit keyboard), ReactFlow canvas
phase: F10
status: in-progress
priority: medium
estimated_size: M
depends_on: [F10-S10]
agent_id: frontend-engineer
source_docs:
  - docs/a11y/keyboard-aria-checklist.md
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-06-12T15:38:24Z

---
# F10-S12 — a11y das telas flagship

> **source_docs:** `docs/a11y/keyboard-aria-checklist.md` (follow-ups do F10-S05); `docs/UX_PRINCIPLES.md` §2.10
> **blocks:** —

## Objetivo

Fechar os follow-ups de acessibilidade que o F10-S05 deixou nas telas flagship (que moram em `features/**`, fora da fronteira do S05): navegação por **teclado** completa no ChatList (setas), no board do Pipeline (dnd-kit `KeyboardSensor`) e no canvas do Flow Builder (ReactFlow a11y), com focus states e aria corretos.

## Contexto

O F10-S05 endureceu a11y nos componentes do `@hm/ui` e no `apps/web/shared`, mas listou em `docs/a11y/keyboard-aria-checklist.md` três interações ricas que precisam de tratamento dentro das features. UX §2.10 (atalho-fantasma) exige que tudo que é operável por mouse seja operável por teclado.

## Escopo (faz)

- `apps/web/features/conversations/**`: ChatList navegável por setas (↑/↓ move foco entre conversas, Enter abre), `role`/`aria-selected` corretos, focus-visible.
- `apps/web/features/pipeline/**`: dnd-kit com `KeyboardSensor` (mover deal entre stages por teclado), instruções `aria` de drag, anúncios `aria-live` de movimento.
- `apps/web/features/flow-builder/canvas/**`: ReactFlow com a11y de nós (foco/seleção por teclado, `aria-label` por nó), respeitando o padrão do v2 (UX §2.1/§2.2: corpo do nó é a ação primária, drag por handle).

## Fora de escopo

- Code-split/lazy mount dessas telas (F10-S10).
- Tokens de contraste / componentes `@hm/ui` (F10-S05, já feito).

## Arquivos permitidos

- `apps/web/features/conversations/**`
- `apps/web/features/pipeline/**`
- `apps/web/features/flow-builder/canvas/**`

## Arquivos proibidos

- `apps/web/features/flow-builder/FlowEditorPage.tsx` e demais paths de `flow-builder` fora de `canvas/` (F10-S10)
- `apps/web/features/dashboard/**`, `apps/web/features/calendar/**` (F10-S10)
- `packages/ui/**`, `packages/design-tokens/**` (F10-S05)

## Definition of Done

- [ ] ChatList: ↑/↓/Enter navegam e abrem; `aria-selected`; focus-visible.
- [ ] Pipeline: deal movível entre stages 100% por teclado (dnd-kit `KeyboardSensor`) com anúncio `aria-live`.
- [ ] Flow canvas: nós focáveis/selecionáveis por teclado, `aria-label` significativo por nó.
- [ ] `pnpm --filter @hm/web typecheck` + `lint` verdes; sem regressão de interação por mouse.

## UX considerations

- **§2.10** (atalho-fantasma): paridade teclado↔mouse nas 3 telas.
- **§2.1/§2.2** (flow): foco no corpo do nó = ação primária; drag só por handle — não regredir.
- **§3.5** (focus/hover ensina): focus-visible nunca suprimido.

## Validação

```bash
pnpm typecheck
pnpm lint
```

## Notas

- Especialista: **frontend-engineer**.
- `blocked` até F10-S10 (compartilham `features/flow-builder`). Leia `docs/a11y/keyboard-aria-checklist.md` para a lista exata de gaps.
- dnd-kit já está no projeto (Pipeline); ReactFlow é `@xyflow/react`. Use as APIs de a11y nativas dessas libs antes de inventar.
