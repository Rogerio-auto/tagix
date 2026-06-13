---
id: F26-S04
title: Subscriptions API por tenant + resolveEntitlements (plano + override)
phase: F26
status: done
priority: high
estimated_size: M
depends_on: [F26-S01]
agent_id: backend-engineer
source_docs:
  - docs/features/PLATFORM_TENANT_MANAGEMENT.md
claimed_at: 2026-06-13T14:47:11Z
completed_at: 2026-06-13T14:50:25Z

---
# F26-S04 — Subscriptions + Entitlements API

> **source_docs:** `docs/features/PLATFORM_TENANT_MANAGEMENT.md` §5.2/§5.3
> **blocks:** F26-S08

## Objetivo

API de plataforma para configurar/personalizar a assinatura de um tenant: atribuir/trocar plano, transitar status (trial→active→past_due→canceled/expired), editar `trial_ends_at` (estender/cortesia), billing_cycle, e **override por tenant** (`workspace_entitlement_overrides`: limites/features não-IA que sobrepõem o plano). Expõe a função única **`resolveEntitlements(workspaceId)`** = `plan.limits/features` merge override. Gated por `requirePlatformAdmin`. **Sem Stripe.**

## Contexto

`plans`/`subscriptions`/`workspaces.{plan_id,subscription_status,trial_ends_at}` existem; `workspace_entitlement_overrides` vem do F26-S01. A policy de IA (allowed_models/caps) já é override de IA (F25-S03); este slot cobre os limites NÃO-IA + a resolução unificada.

## Escopo (faz)

- `apps/api/src/routes/platform/subscriptions.ts` (novo): `GET /platform/workspaces/:id/subscription` (plano+status+trial+override+entitlements efetivos), `PUT .../subscription` (trocar plano/status/trial/cycle), `PUT .../entitlement-overrides` (limites/features override). Zod + audit + `updated_by`.
- `apps/api/src/services/platform/entitlements.ts` (novo): `resolveEntitlements(workspaceId)` (merge plano+override; fonte única — UI e futuro enforcement leem dela).
- Teste (troca de plano, override, resolução; transições de status válidas).

## Fora de escopo

- Stripe/cobrança. CRUD do catálogo de planos (F26-S03). Enforcement no produto (follow-up incremental). UI (F26-S08).

## Arquivos permitidos

- `apps/api/src/routes/platform/subscriptions.ts`
- `apps/api/src/services/platform/entitlements.ts`
- `apps/api/src/routes/platform/subscriptions.test.ts`

## Arquivos proibidos

- `apps/api/src/app.ts`, outros `routes/platform/*`

## Definition of Done

- [ ] Troca de plano/status/trial/cycle + override funcionam; `resolveEntitlements` retorna o merge correto (override > plano); transições de status validadas.
- [ ] Tudo gated + auditado (before/after); cross-workspace como owner.
- [ ] `pnpm --filter @hm/api test` + lint/typecheck verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**. Exporta `createPlatformSubscriptionsRouter()` + `resolveEntitlements()` p/ wire. Reusa as chaves tipadas de limits/features definidas no F26-S03.
