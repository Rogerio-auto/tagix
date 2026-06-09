---
id: F0-S12
title: Infra de UX — EmptyState, ErrorState, HelpPanel, CommandPalette, atalhos, density
phase: F0
status: review
priority: high
estimated_size: M
depends_on: [F0-S11]
agent_id: backend-engineer
claimed_at: 2026-06-09T13:31:38Z
completed_at: 2026-06-09T13:35:38Z

---
# F0-S12 — Infra de UX (estados, help, command palette, atalhos)

> Sem equivalente direto no ROADMAP — extrai os padrões transversais de `UX_PRINCIPLES.md` em componentes/hooks reutilizáveis para que TODA feature já nasça cumprindo o checklist DoD UX.
> **source_docs:** `docs/UX_PRINCIPLES.md` §2.5, §2.6, §2.7, §2.10, §2.11, §3.6, §3.8; `docs/DESIGN_SYSTEM.md` §10.3, §10.4, §11
> **blocks:** todas as features de frontend (F1+)

## Objetivo

Entregar os blocos de UX que as features reusam: EmptyState (com CTA), ErrorState (3 partes), LoadingState/Skeleton patterns, HelpPanel (`?`), CommandPalette (Cmd/Ctrl+K) + registro de atalhos, e preferência de density.

## Contexto

`UX_PRINCIPLES.md` exige empty/loading/error em toda lista, help inline via `?`, atalhos universais e density. Centralizar isso evita reimplementação divergente por feature e torna o checklist §4 verificável.

## Escopo (faz)

- `shared/components/feedback/EmptyState.tsx` — ícone Lucide grande (`--text-low`), título Rajdhani 28px, 1-2 linhas, **1 CTA primário** (Button brand) (UX §2.6, DS §10.3).
- `shared/components/feedback/ErrorState.tsx` — 3 partes (o quê / por quê / o que fazer) + `Ref: hm_err_*` copiável; nunca stack trace (UX §2.11).
- `shared/components/feedback/LoadingState.tsx` + `SkeletonList`/`SkeletonBubbles` — skeleton no lugar do conteúdo, não spinner solto (UX §2.7, §3.6, DS §10.4).
- `shared/components/help/HelpPanel.tsx` + `HelpButton` (`?`) — abre `Sheet` lateral persistente (texto + exemplos + link), some só ao fechar (UX §2.5, DS §11). Conteúdo por feature em `features/<f>/help.tsx`.
- `shared/components/command/CommandPalette.tsx` — overlay Cmd/Ctrl+K com busca de comandos/navegação; registro extensível por feature.
- `shared/hooks/useKeyboardShortcuts.ts` — registro/cleanup de atalhos; provê `Cmd/Ctrl+K`, `?` (lista de atalhos), `Esc` globais (UX §2.10).
- `shared/hooks/useDensity.ts` + `shared/stores/ui.store.ts` (Zustand) — density `comfortable|compact` (default comfortable) + estado do command palette (UX §3.8).
- Stories Ladle dos componentes de feedback/help (se Ladle alcançar paths do app; senão, exemplos numa rota `/_dev` protegida — opcional).

## Fora de escopo

- Página `/settings/me/*` de preferências/atalhos/notificações (vai com Settings, fase posterior) — aqui só o hook/store + persistência local; o sync com backend vem depois.
- Inbox de notificações persistente e push/email (UX §2.12 níveis 2/3) — fora do MVP de fundação.
- Tour guiado / onboarding (UX §9 não-objetivo).

## Arquivos permitidos

- `apps/web/shared/components/feedback/**`
- `apps/web/shared/components/help/**`
- `apps/web/shared/components/command/**`
- `apps/web/shared/hooks/useKeyboardShortcuts.ts`
- `apps/web/shared/hooks/useDensity.ts`
- `apps/web/shared/stores/ui.store.ts`

## Arquivos proibidos

- `apps/web/app/**`, `apps/web/shared/components/layout/**`, `apps/web/shared/lib/**` (F0-S11)
- `apps/web/features/auth/**` (F0-S13)
- `packages/**`

## Contratos de saída

- `import { EmptyState, ErrorState, SkeletonList } from '@/shared/components/feedback'`
- `import { HelpButton, HelpPanel } from '@/shared/components/help'`
- `useKeyboardShortcuts(map)`, `useDensity()`, `useCommandPalette()` — APIs estáveis usadas por features.
- `PageHeader` (de F0-S11) recebe `<HelpButton/>` no seu slot `helpSlot`.

## Definition of Done

- [ ] EmptyState força exatamente 1 CTA primário (brand).
- [ ] ErrorState renderiza as 3 partes + ref copiável; sem stack trace.
- [ ] Skeleton respeita `prefers-reduced-motion`.
- [ ] HelpPanel abre/fecha por clique no `?`, Esc e click-out; persiste até fechar.
- [ ] CommandPalette abre com Cmd/Ctrl+K e fecha com Esc; navegação por teclado.
- [ ] `?` lista atalhos da página atual.
- [ ] Density alterna comfortable/compact e persiste.
- [ ] `pnpm typecheck` e `pnpm lint` limpos.

## UX considerations

- Implementa diretamente os anti-padrões §2.5 (tooltip-substituto→HelpPanel), §2.6 (empty-state), §2.7/§3.6 (skeleton), §2.10 (atalhos), §2.11 (erro com 3 partes).
- Aplica §3.8 (density adaptável).
- ARIA: CommandPalette `role="dialog"`+focus trap; ErrorState `role="alert"`; HelpPanel `role="complementary"` (DS §8.2).

## Validação

```bash
pnpm typecheck
pnpm lint
```

## Notas

- `Sheet`/`Drawer` base ainda não está em `@hm/ui` (§4.10). Este slot pode implementar um `Sheet` mínimo local em `shared/components/help/` OU promover um `Sheet` ao `@hm/ui` num sub-slot dedicado antes — decidir no claim. Preferência: Sheet local agora, promover depois quando uma segunda feature precisar.
