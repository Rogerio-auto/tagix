---
id: F36-S02
title: Casca mobile (bottom nav + drawer) + PWA instalável
phase: F36
status: blocked
priority: critical
estimated_size: M
depends_on:
  - F36-S01
blocks:
  - F36-S14
source_docs:
  - docs/features/MOBILE_RESPONSIVE_PLAN.md
agent_id: frontend-engineer
---
# F36-S02 — Casca mobile + PWA

## Objetivo

Tornar a navegação mobile excelente (thumb-first) e o app instalável: bottom tab bar para os destinos primários + drawer "Mais", `TopBar` responsivo com safe-area, e PWA (manifest + ícones + installable).

## Contexto

`AppLayout` já tem `Sidebar` como drawer (`mobileOpen`) + `TopBar` com hambúrguer. Falta a barra inferior (zona do polegar), o respeito a safe-area, e o empacotamento PWA. Consome `useBreakpoint`/safe-area de S01.

## Escopo (faz)

- **`apps/web/shared/components/layout/**`** — novo `BottomNav` (≤5 destinos por role, ícone+label, alvos ≥44px, safe-area inferior), visível `< md`, oculto em desktop; `Sidebar` vira só desktop (`md+`) + drawer "Mais" no mobile pros destinos extras; `TopBar` compacto no mobile (título da rota + ações essenciais). `AppLayout` orquestra qual chrome mostrar por breakpoint.
- **PWA**: `apps/web/app/manifest.ts` (ou `public/manifest.webmanifest`) com nome/cores/ícones/`display:standalone`/`theme_color` (tokens DS); `apps/web/public/icons/**` (maskable 192/512); meta/links no `apps/web/app/layout.tsx` (manifest, theme-color, apple-touch-icon, viewport-fit=cover). Offline-shell é opcional (registrar só se trivial).

## Fora de escopo

- Conteúdo das telas (S03+). Service worker de cache offline complexo (futuro).

## Arquivos permitidos

- `apps/web/shared/components/layout/**`
- `apps/web/app/layout.tsx`
- `apps/web/app/manifest.ts`
- `apps/web/public/**`

## Arquivos proibidos

- `apps/web/app/globals.css` (S01)
- `apps/web/features/**`

## Definition of Done

- [ ] `< md`: bottom nav com destinos primários (gating por role via `can()`); `md+`: sidebar desktop intacta (zero regressão).
- [ ] Safe-area respeitada (notch/barra inferior) no shell.
- [ ] App instalável (manifest válido, ícones maskable, theme-color); "Adicionar à tela inicial" abre em standalone.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## UX considerations

- §2.4 path óbvio (destinos primários sempre visíveis na barra, não em menu profundo); thumb-first (§4 do plano).
- §2.10 — `⌘K` ainda acessível; foco/teclado preservados.

## Notas

Os destinos primários por role devem espelhar a `Sidebar` atual (não inventar IA de navegação). O "Mais" cobre o overflow. Confirmar viewport meta com `viewport-fit=cover` pra safe-area funcionar.
