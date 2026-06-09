---
id: F0-S11
title: apps/web shell — Next 15 App Router + providers + theme-no-flash + AppLayout
phase: F0
status: blocked
priority: high
estimated_size: L
depends_on: [F0-S10]
---

# F0-S11 — apps/web shell (Next 15 + providers + AppLayout)

> Refina o ROADMAP F0-S10 (frontend skeleton). Substitui o stub atual de `apps/web` pelo app Next.js real.
> **source_docs:** `docs/DESIGN_SYSTEM.md` §5.1, §9 (estrutura, tema sem flash, state); `docs/ARCHITECTURE.md` §11.2; `docs/UX_PRINCIPLES.md` §2.4, §3.5
> **blocks:** F0-S12, F0-S13

## Objetivo

Levantar o app Next.js 15 (App Router) com providers (TanStack Query, Theme, Toast), tema dark/light sem flash, tokens DS v2 carregados, e o AppLayout (sidebar + topbar) presentacional para as rotas autenticadas.

## Contexto

Hoje `apps/web` é um stub TS sem React/Next. Este slot cria o casco navegável: estrutura `app/`, `globals.css` importando `@hm/design-tokens/tokens.css`, fontes via `next/font`, AppLayout, stores Zustand (auth-snapshot, theme) e o api-client tipado. Desbloqueia a infra de UX (F0-S12) e a tela de Login (F0-S13).

## Escopo (faz)

- Config: `apps/web/package.json` (next 15, react 19, @tanstack/react-query, zustand, @hm/ui, @hm/design-tokens, @hm/shared, tailwindcss 4, @hookform/resolvers, react-hook-form, zod), `tsconfig.json` (moduleResolution Bundler, jsx preserve, paths `@/*`), `next.config.mjs` (`output: 'standalone'`, `images.remotePatterns` p/ R2), `tailwind.config.ts` (importa preset de `@hm/design-tokens`), `postcss.config.mjs`.
- `app/layout.tsx` — `<html lang="pt-BR" data-theme>` + script inline anti-flash (DS §9.4), `next/font` (Rajdhani/Manrope/Chakra Petch/Orbitron), `<Providers>`.
- `app/globals.css` — `@import '@hm/design-tokens/tokens.css'` + reset + base typography.
- `app/providers.tsx` (`'use client'`) — QueryClientProvider + ThemeProvider + ToastProvider (do @hm/ui).
- `app/(auth)/layout.tsx` — layout enxuto centrado (a tela de login é F0-S13).
- `app/(app)/layout.tsx` — AppLayout; valida sessão server-side (stub que lê cookie via `shared/lib/supabase-server` placeholder; wiring real em auth backend — ver Notas) e redireciona p/ `/login` se ausente.
- `app/(app)/page.tsx` — dashboard placeholder usando PageHeader + EmptyState (EmptyState importado de F0-S12; até lá, placeholder simples).
- `shared/components/layout/**` — `AppLayout`, `Sidebar` (nav, active = border-left brand + bg surface-3), `TopBar` (mobile: menu+breadcrumbs), `PageHeader` (title + action slot + slot p/ `?` help de F0-S12).
- `shared/lib/**` — `cn.ts` (reexport do @hm/ui ou local), `api-client.ts` (fetch tipado server+client), `query-client.ts`, `supabase-browser.ts` + `supabase-server.ts` (stubs tipados), `theme.store.ts`.
- `shared/stores/auth.store.ts` e `shared/stores/theme.store.ts` (Zustand).
- `middleware.ts` — checagem de cookie de sessão (stub) com allowlist de rotas públicas.

## Fora de escopo

- Telas de Login/ResetPassword e `features/auth/**` (F0-S13).
- EmptyState/ErrorState/HelpPanel/CommandPalette/atalhos/density (F0-S12).
- Qualquer feature de produto (conversations, agents, etc.).
- Integração real de auth Supabase (depende dos slots de auth backend — Notas).

## Arquivos permitidos

- `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.mjs`, `apps/web/tailwind.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/middleware.ts`
- `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/providers.tsx`
- `apps/web/app/(auth)/layout.tsx`
- `apps/web/app/(app)/**`
- `apps/web/shared/components/layout/**`
- `apps/web/shared/lib/**`
- `apps/web/shared/stores/auth.store.ts`, `apps/web/shared/stores/theme.store.ts`
- (remover o stub) `apps/web/src/**`

## Arquivos proibidos

- `apps/web/app/(auth)/login/**`, `apps/web/app/(auth)/reset-password/**`, `apps/web/features/auth/**` (F0-S13)
- `apps/web/shared/components/feedback/**`, `apps/web/shared/components/help/**`, `apps/web/shared/components/command/**`, `apps/web/shared/hooks/**`, `apps/web/shared/stores/ui.store.ts` (F0-S12)
- `packages/**`

## Contratos de entrada/saída

- Consome `@hm/ui` (Button/ToastProvider) e `@hm/design-tokens` (preset/tokens).
- Expõe `AppLayout`, `PageHeader` (com slot `helpSlot`) para features.
- `api-client` expõe `api.get/post/...` tipados; base URL via env `NEXT_PUBLIC_API_URL`.

## Definition of Done

- [ ] `pnpm --filter @hm/web build` ok (`output: 'standalone'` gera `.next/standalone`).
- [ ] Tema dark/light sem flash (script inline antes do hydrate); toggle persiste em localStorage.
- [ ] Rota `(app)` protegida redireciona p/ `/login` quando sem sessão.
- [ ] AppLayout responsivo: sidebar fixa em lg+, drawer em mobile.
- [ ] Zero hex hardcoded; tudo via tokens.
- [ ] `pnpm typecheck` e `pnpm lint` limpos.

## UX considerations

- Aplica UX §2.4 (caça ao tesouro): nav da Sidebar com **label** visível, não só ícone; ícones sem label só p/ os 6 universais.
- Aplica UX §3.5 (cursor/hover): nav items com hover state claro e `cursor-pointer`.
- Aplica DS §5.1 (AppLayout) e §9.4 (tema sem flash).
- Prepara o slot `?` no PageHeader p/ o HelpPanel (UX §2.5) que vem em F0-S12.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- **Auth real depende dos slots de backend** (ROADMAP F0-S05 IAuthProvider/Supabase login + F0-S06 Express `requireAuth`/`can()`). Aqui os helpers Supabase são stubs tipados e o middleware lê cookie sem validar assinatura. Quando os slots de auth fecharem, um slot de "wiring auth web" liga as pontas. Documentar o TODO no código.
- Porta dev do web é 3000 — conflita com WAHA (infra dev). Subir web em 3000 exige `docker compose stop waha` ou remapear; deixar nota no README do app.
