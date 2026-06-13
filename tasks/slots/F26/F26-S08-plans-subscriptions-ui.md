---
id: F26-S08
title: Planos + Assinatura/Entitlements UI (frontend platform-admin)
phase: F26
status: blocked
priority: medium
estimated_size: L
depends_on: [F26-S03, F26-S04]
agent_id: frontend-engineer
source_docs:
  - docs/features/PLATFORM_TENANT_MANAGEMENT.md
  - docs/UX_PRINCIPLES.md
---

# F26-S08 — Planos + Assinatura UI

> **source_docs:** `docs/features/PLATFORM_TENANT_MANAGEMENT.md` §5; `docs/UX_PRINCIPLES.md`
> **blocks:** —

## Objetivo

Duas frentes de UI: **Plans** (catálogo — CRUD de planos com editor tipado de limits/features, F26-S03) e **Assinatura por tenant** (no contexto do workspace: trocar plano, status, estender trial, billing_cycle, e **override "custom plan"** de limites/features, mostrando os **entitlements efetivos** resolvidos — F26-S04). DS v2 dark-first. **Sem Stripe** (gestão interna).

## Contexto

Shell/lib do F25-S06; 360 do F26-S07. Consome plans API (S03) e subscriptions/entitlements API (S04).

## Escopo (faz)

- `apps/web/app/(platform)/platform/plans/**` + `apps/web/features/platform-admin/plans/**`: catálogo (lista/criar/editar/ativar/ordenar), editor tipado de limits/features.
- `apps/web/app/(platform)/platform/subscriptions/**` + `apps/web/features/platform-admin/subscriptions/**`: editor de assinatura por workspace (plano/status/trial/cycle/override) + painel de entitlements efetivos (override > plano).

## Fora de escopo

- Backend (S03/S04). Stripe/checkout. Shell/lib (F25-S06). Tenants/360 (F26-S07).

## Arquivos permitidos

- `apps/web/app/(platform)/platform/plans/**`
- `apps/web/app/(platform)/platform/subscriptions/**`
- `apps/web/features/platform-admin/plans/**`
- `apps/web/features/platform-admin/subscriptions/**`

## Arquivos proibidos

- `apps/web/features/platform-admin/{shell,lib,tenants}/**`, outras subpastas

## Definition of Done

- [ ] Plans: CRUD + editor tipado de limits/features; Assinatura: trocar plano/status/trial/cycle + override, mostrando entitlements efetivos resolvidos.
- [ ] Nenhuma cobrança/checkout (gestão interna); DS v2 dark-first (zero hex); confirmação em ações de impacto (downgrade/cancelar).
- [ ] `pnpm --filter @hm/web typecheck` + lint + `build` verdes.

## UX considerations

- **§2.8** (mega-form): editor de plano/assinatura em seções (limites / features / billing), não um monstro.
- **§2.9** (botão-suicida): downgrade/cancelar/reduzir limite pede confirmação com impacto.
- **§3.6** skeleton; **§2.7** feedback claro no save.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: **frontend-engineer**. Reusa lib do F25. Paraleliza com F26-S09/S10. Link na nav = glue do orchestrator.
