---
id: F36-S12
title: Auth (login/reset) — polish mobile
phase: F36
status: blocked
priority: low
estimated_size: S
depends_on:
  - F36-S01
blocks:
  - F36-S14
source_docs:
  - docs/features/MOBILE_RESPONSIVE_PLAN.md
agent_id: frontend-engineer
---
# F36-S12 — Auth mobile

## Objetivo

Polir login e reset de senha pro celular: paddings/safe-area, teclado (tipos de input + autofill), inputs 16px, CTA full-width na zona do polegar.

## Contexto

Forms curtos centrados — já quase ok; falta refino mobile. Consome utilitárias de S01.

## Escopo (faz)

- **`apps/web/app/(auth)/**`** (+ `apps/web/features/auth/**` se existir) — em mobile: card full-width com paddings adequados, `inputMode`/`autoComplete` corretos (email/senha), inputs 16px, botão de submit full-width fixo/visível com teclado aberto, safe-area; erro com as 3 partes (§2.11).

## Fora de escopo

- Mudança no fluxo de auth/provider.

## Arquivos permitidos

- `apps/web/app/(auth)/**`
- `apps/web/features/auth/**`

## Arquivos proibidos

- `apps/api/**`, `packages/**`

## Definition of Done

- [ ] `< md`: login/reset confortáveis no toque, teclado certo, sem zoom, CTA acessível.
- [ ] `md+`: inalterado.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- §2.7 loading no submit; §2.11 erro 3-partes; inputs 16px + autofill.

## Notas

Pequeno, mas é a primeira tela — primeira impressão mobile. Caprichar.
