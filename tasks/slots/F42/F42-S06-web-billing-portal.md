---
id: F42-S06
title: Billing portal self-serve (web, settings/billing)
phase: F42
status: done
priority: high
estimated_size: M
depends_on: [F42-S04]
blocks: [F42-S09]
agent_id: frontend-engineer
source_docs:
  - docs/features/PAYMENTS_ABACATEPAY.md
  - docs/UX_PRINCIPLES.md
---

# F42-S06 — Billing portal (self-serve)

> **source_docs:** `docs/features/PAYMENTS_ABACATEPAY.md` §8; `docs/UX_PRINCIPLES.md`
> **blocks:** F42-S09

## Objetivo

Tela de billing self-serve em `settings/billing`: ver plano/status atual, escolher plano+ciclo e ser
redirecionado ao checkout hospedado, ver método/próximo vencimento/histórico, cancelar. DS v2 dark-first.

## Contexto

Consome a API do F42-S04. Reusa o status existente (`trial`/`active`/`past_due`) para banners.

## Escopo (faz)

- `apps/web/app/(app)/settings/billing/page.tsx` (rota).
- `apps/web/features/billing/**`: seletor de plano/ciclo, card de assinatura atual, histórico de
  cobranças, ação cancelar, banners de trial/past_due, retorno do checkout (`returnUrl`).
- Entrada no nav de settings (`apps/web/features/settings/shell/SettingsSidebar.tsx`).

## Fora de escopo

- API (F42-S04). Plataforma assistida (F42-S07/S08). QR PIX embutido (usamos checkout hospedado).

## Arquivos permitidos

- `apps/web/app/(app)/settings/billing/page.tsx`
- `apps/web/features/billing/**`
- `apps/web/features/settings/shell/SettingsSidebar.tsx`

## Arquivos proibidos

- `apps/api/**`, `apps/web/features/platform-admin/**`

## Definition of Done

- [ ] Fluxo de upgrade redireciona ao checkout e trata o retorno; estado atual e histórico exibidos.
- [ ] Zero hex hardcoded; tokens semânticos de `@hm/design-tokens`.
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes.

## UX considerations

- DS v2 dark-first; tipografia editorial (CLAUDE.md padrão de design).
- Evitar full-screen modal para escolher plano (anti-padrão `UX_PRINCIPLES §2`); usar layout in-page.
- Estados claros de `trial`/`past_due`/`active` (princípio de feedback de estado, `UX_PRINCIPLES §3`).
- Mobile-first/responsivo (regra de ouro `isMobile=estrutura`, F36).

## Permission scope

- Visível para roles que gerenciam billing (OWNER/ADMIN). Ver `docs/features/PERMISSIONS.md §2`.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Não tentar validar por Playwright neste host (não hidrata
  local — validar por typecheck/lint/build/unit).
