---
id: F10-S05
title: a11y audit + AAA contraste + navegação por teclado
phase: F10
status: done
priority: medium
estimated_size: M
depends_on: [F10-S04]
agent_id: frontend-engineer
source_docs:
  - docs/ROADMAP.md#F10-S07
  - docs/UX_PRINCIPLES.md
  - docs/DESIGN_SYSTEM.md
claimed_at: 2026-06-12T14:28:01Z
completed_at: 2026-06-12T14:30:06Z

---
# F10-S05 — Accessibility audit + fixes

> **source_docs:** `docs/ROADMAP.md` F10-S07; `docs/UX_PRINCIPLES.md` §2.10; `docs/DESIGN_SYSTEM.md`
> **blocks:** F10-S06 (perf reusa `apps/web/shared`).

## Objetivo

Auditoria de acessibilidade e correções: validar **contraste AAA** dos tokens de texto, garantir **navegação completa por teclado** + focus states visíveis nas telas flagship, corrigir aria-roles/labels nos componentes do `@hm/ui`, e produzir relatório em `docs/a11y/`.

## Contexto

UX_PRINCIPLES §2.10 ("atalho-fantasma") exige suporte a teclado; o padrão global do Rogério exige contraste AAA. Depende de F10-S04 porque ambos tocam `packages/ui` (sequencial, não paralelo).

## Escopo (faz)

- `packages/design-tokens/**`: ajustar tokens semânticos de texto/superfície que falham AAA (mantendo dark-first).
- `packages/ui/src/**`: aria-roles/labels, `:focus-visible` states, ordem de tabulação, `aria-live` onde houver feedback (§2.7).
- `apps/web/shared/**`: focus traps em drawers, skip-to-content, navegação por teclado nas telas flagship.
- `docs/a11y/**`: relatório do axe-scan + checklist AAA + o que ficou como follow-up.

## Fora de escopo

- Perf/bundle (F10-S06).
- Novos componentes (só ajustar existentes + os de F10-S04).

## Arquivos permitidos

- `packages/design-tokens/**`
- `packages/ui/src/**`
- `apps/web/shared/**`
- `docs/a11y/**`

## Arquivos proibidos

- `apps/web/next.config.mjs` (F10-S06)
- `apps/web/e2e/**` (F10-S03)

## Definition of Done

- [ ] axe-core scan sem violações críticas/sérias nas telas flagship; relatório em `docs/a11y/`.
- [ ] Contraste **AAA** validado para tokens de texto (documentar pares testados).
- [ ] Navegação 100% por teclado nas telas flagship; `:focus-visible` visível; Esc/Tab corretos.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/ui test` verdes.

## UX considerations

- **§2.10** (atalho-fantasma): teclado em tudo que é clicável.
- **§3.5** (cursor + hover/focus ensina): focus-visible nunca suprimido.
- **§2.7** (click-fantasma): `aria-live` para feedback de ação.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/ui test
```

## Notas

- Especialista: **frontend-engineer**.
- `blocked` até F10-S04 fechar (compartilham `packages/ui`).
