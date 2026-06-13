---
id: F25-S06
title: Platform-admin frontend shell — route group (platform) + guard + nav
phase: F25
status: done
priority: high
estimated_size: M
depends_on: []
agent_id: frontend-engineer
source_docs:
  - docs/ROADMAP.md#F2.5
  - docs/UX_PRINCIPLES.md
  - docs/DESIGN_SYSTEM.md
claimed_at: 2026-06-13T01:16:53Z
completed_at: 2026-06-13T01:17:56Z

---
# F25-S06 — Platform-admin frontend shell

> **source_docs:** `docs/ROADMAP.md` F2.5-S01; `docs/UX_PRINCIPLES.md`; `docs/DESIGN_SYSTEM.md`
> **blocks:** F25-S07, F25-S08

## Objetivo

Esqueleto do painel de super-admin (DS v2 dark-first): um **route group dedicado** `apps/web/app/(platform)/` com layout/nav próprios e **guard de acesso** (`is_platform_admin` — redireciona não-admin), separado do app de workspace. Provê o shell que as páginas (S07/S08) preenchem.

## Contexto

A sessão expõe `isPlatformAdmin`; o backend gate é F25-S01. No frontend, o painel é uma área à parte (não é "settings de workspace"). `apps/web/middleware.ts` já trata auth de rotas — estendê-lo para proteger `(platform)` no edge é a defesa primária; o layout reforça client-side.

## Escopo (faz)

- `apps/web/app/(platform)/layout.tsx` + `apps/web/app/(platform)/page.tsx` (home do painel): shell com nav (Modelos / Políticas / Secrets / Uso), guard que redireciona quem não é platform admin.
- `apps/web/features/platform-admin/shell/**`: layout/nav/guard components (DS v2, tokens semânticos).
- `apps/web/features/platform-admin/lib/**`: client/hooks compartilhados (fetchers das APIs de plataforma, tipos).
- `apps/web/middleware.ts`: proteção edge da rota `(platform)` (aditivo, sem regredir auth de workspace).

## Fora de escopo

- Páginas de conteúdo (S07: modelos/políticas; S08: secrets/uso). Backend (S01-S05).

## Arquivos permitidos

- `apps/web/app/(platform)/layout.tsx`
- `apps/web/app/(platform)/page.tsx`
- `apps/web/features/platform-admin/shell/**`
- `apps/web/features/platform-admin/lib/**`
- `apps/web/middleware.ts`

## Arquivos proibidos

- `apps/web/app/(app)/**`, `apps/web/features/platform-admin/{models,policies,secrets,usage}/**` (S07/S08)

## Definition of Done

- [ ] Route group `(platform)` com layout/nav próprios; não-platform-admin é redirecionado (edge no middleware + reforço no layout).
- [ ] DS v2 dark-first, tokens semânticos (zero hex); auth de workspace **inalterada**.
- [ ] `pnpm --filter @hm/web typecheck` + lint + `build` verdes.

## UX considerations

- **§3.3** help inline `?` onde a ação é sensível (ex. nav de Secrets).
- **§2.4** (caça ao tesouro): nav clara das 4 áreas; área de plataforma visualmente distinta do workspace.
- Distinção visual forte (é um modo "admin de plataforma", não workspace) sem parecer template.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**.
- Path real é `apps/web/app/(platform)/` e `apps/web/features/platform-admin/` (criar) — NÃO `src/features/...` (não existe `src/`). Disponível desde o início (não depende das APIs p/ o shell).
