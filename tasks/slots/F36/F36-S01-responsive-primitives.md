---
id: F36-S01
title: Primitivos responsivos — Sheet, useBreakpoint, safe-area, MOBILE_UX
phase: F36
status: in-progress
priority: critical
estimated_size: M
depends_on: []
blocks:
  - F36-S02
  - F36-S03
  - F36-S04
  - F36-S05
  - F36-S06
  - F36-S07
  - F36-S11
  - F36-S12
source_docs:
  - docs/features/MOBILE_RESPONSIVE_PLAN.md
  - docs/UX_PRINCIPLES.md
agent_id: frontend-engineer
claimed_at: 2026-06-16T19:11:42Z

---
# F36-S01 — Primitivos responsivos

## Objetivo

Entregar os blocos compartilhados que todas as telas mobile vão consumir: componente `Sheet` (bottom/full-sheet), hook `useBreakpoint`, utilitários de safe-area + alvo-de-toque, e a doc `MOBILE_UX.md` + atualização do `UX_PRINCIPLES §8`. É a fundação — S02..S07/S11/S12 dependem dela.

## Contexto

O app é desktop-first (UX_PRINCIPLES §8 adiava mobile). Esta é a fase mobile. O drawer lateral do §2.3 vira bottom-sheet no mobile; precisamos do primitivo antes de aplicar nas telas.

## Escopo (faz)

- **`apps/web/shared/components/Sheet/**`** (novo) — `Sheet` mobile: desliza de baixo (bottom-sheet) ou full-sheet; handle de arraste; fecha com swipe-down, backdrop e `Esc`; focus-trap + `role="dialog"` + `aria-modal`; animação < 250ms (`motion-safe`). API próxima do drawer atual pra adoção fácil.
- **`apps/web/shared/hooks/useBreakpoint.ts`** (novo) — `useBreakpoint()` → `'mobile' | 'tablet' | 'desktop'` + helpers `isMobile` etc., SSR-safe (sem flash), baseado em `matchMedia`. Corte mobile `< md` (768px) — D4.
- **`apps/web/app/globals.css`** — utilitárias de `env(safe-area-inset-*)` (`.pb-safe`, `.pt-safe`), classe de alvo-de-toque mínimo (≥44px) e `font-size:16px` base em inputs (evita zoom iOS). Sem hex; só tokens.
- **`docs/MOBILE_UX.md`** (novo) — padrões mobile da §4/§5 do plano (thumb-first, sheet, tabela→cards, gestos, PWA) como referência citável.
- **`docs/UX_PRINCIPLES.md`** — reescrever §8/§9 promovendo mobile a cidadão de primeira classe (remover "mobile é fase 2") e linkar `MOBILE_UX.md`.

## Fora de escopo

- Bottom nav / PWA manifest (S02). Aplicação nas telas (S03+).

## Arquivos permitidos

- `apps/web/shared/components/Sheet/**`
- `apps/web/shared/hooks/useBreakpoint.ts`
- `apps/web/shared/hooks/useMediaQuery.ts`
- `apps/web/app/globals.css`
- `docs/MOBILE_UX.md`
- `docs/UX_PRINCIPLES.md`

## Arquivos proibidos

- `apps/web/shared/components/layout/**` (S02)
- `apps/web/features/**`

## Definition of Done

- [ ] `Sheet` abre/fecha por backdrop, `Esc` e swipe-down; focus-trap e ARIA corretos; SSR sem flash.
- [ ] `useBreakpoint` retorna o tier certo e reage a resize; sem warning de hydration.
- [ ] Safe-area + alvo-de-toque + input 16px disponíveis como utilitárias.
- [ ] `MOBILE_UX.md` criado; `UX_PRINCIPLES §8` atualizado.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- §2.3 — drawer→sheet (mantém contexto; não é modal-cobre-tudo).
- §2.7 — feedback/transição < 250ms; §3.10 animação propositada.
- Acessibilidade: focus ring, `role="dialog"`, `aria-modal`, trap + restauração de foco.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

NÃO colocar o `Sheet` em `@hm/ui` (gotcha do barrel client→server leak, F10) — mantê-lo em `apps/web/shared/components`. Reaproveitar `cn` de `@/shared/lib/cn`.
