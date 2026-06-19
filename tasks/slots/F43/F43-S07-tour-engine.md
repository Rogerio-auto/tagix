---
id: F43-S07
title: Engine de tour guiado in-house (DS v2, spotlight, estado por membro)
phase: F43
status: in-progress
priority: medium
estimated_size: M
depends_on: [F43-S01, F43-S04, F43-S05]
blocks: [F43-S08]
agent_id: frontend-engineer
source_docs:
  - docs/features/ONBOARDING.md
  - docs/UX_PRINCIPLES.md
ux_considerations:
  - "Aplica 2.5/3.3 — tour ensina o uso (passo a passo), complementa o HelpPanel `?`, não substitui por tooltip."
  - "Aplica 2.10 — `Esc` fecha/pula; navegação por teclado entre passos; foco gerenciado."
  - "Aplica 3.10 — animações motion-safe < 250ms; spotlight intencional, sem poluição."
claimed_at: 2026-06-19T23:00:23Z

---
# F43-S07 — Engine de tour guiado (in-house)

> **source_docs:** `docs/features/ONBOARDING.md` §4.1; `docs/UX_PRINCIPLES.md`
> **depends_on:** F43-S01 (`members.tour_state`), F43-S04 (`PUT /api/me/tour-state`), F43-S05 (mount do shell + stub)
> **blocks:** F43-S08 (conteúdo)

## Objetivo

Construir um engine de tour próprio (spotlight/coachmark) em DS v2 — sem dependência pesada —
com passos declarativos por tela, ancorados via `data-tour-id` e estado persistido por membro.

## Escopo (faz)

- `apps/web/shared/components/tour/**`: `TourProvider`, `useTour`, `TourSpotlight` (overlay +
  recorte do alvo), navegação (próximo/anterior/pular), `data-tour-id` resolver.
- Preencher o stub `GuidedTourMount` (criado em F43-S05) com o provider real.
- Persistir conclusão/dispensa via `PUT /api/me/tour-state`; não reabrir um tour já visto.
- Acessibilidade: foco gerenciado, `Esc`, navegação por teclado, `aria` no overlay; `motion-safe`.
- **Apenas o engine** — sem o conteúdo dos passos (F43-S08), mas com um tour de exemplo mínimo para teste.

## Fora de escopo

- Conteúdo dos tours e âncoras `data-tour-id` nas telas (F43-S08).

## Arquivos permitidos

- `apps/web/shared/components/tour/**`
- `apps/web/shared/components/tour/GuidedTourMount.tsx`

## Arquivos proibidos

- `apps/web/features/**` de telas específicas (dashboard/inbox/pipeline/agents/flows) — âncoras são F43-S08
- `apps/api/**`, `packages/**`

## Definition of Done

- [ ] Engine renderiza spotlight ancorado em `data-tour-id`, navega passos, persiste estado por membro.
- [ ] `Esc`/pular/teclado funcionam; foco gerenciado; sem dependência nova pesada.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Evitar barrel client→server leak (memória F10): tour vive em
  `apps/web/shared/components`, não no pacote `@hm/ui` server-safe.
