---
id: F26-S03
title: Plans CRUD API — catálogo de planos (limits/features tipados, sem Stripe)
phase: F26
status: done
priority: high
estimated_size: M
depends_on: []
agent_id: backend-engineer
source_docs:
  - docs/features/PLATFORM_TENANT_MANAGEMENT.md
claimed_at: 2026-06-13T14:42:18Z
completed_at: 2026-06-13T14:46:58Z

---
# F26-S03 — Plans CRUD API

> **source_docs:** `docs/features/PLATFORM_TENANT_MANAGEMENT.md` §5.1
> **blocks:** F26-S08

## Objetivo

API de plataforma para o catálogo comercial `plans`: CRUD (criar/editar/ativar/posicionar) com editor TIPADO de `limits` (ex. max_agents/max_channels/max_monthly_messages) e `features` (ex. instagram/flows/api_access) — não jsonb cru. **Gestão interna, sem Stripe** (campos stripe_* ficam editáveis mas opcionais; nenhuma chamada Stripe).

## Contexto

`plans` já existe (key/name/prices/limits jsonb/features jsonb/stripe IDs/is_active/position). Este slot é o CRUD + um schema Zod tipado das chaves conhecidas de limits/features (fonte da verdade do catálogo de entitlements). `BILLING_ENABLED=false`.

## Escopo (faz)

- `apps/api/src/routes/platform/plans.ts` (novo): `GET/POST/PATCH/DELETE /platform/plans` (delete = soft via is_active), Zod com chaves conhecidas de limits/features (rejeita chave desconhecida ou aceita com warning — definir), gated por platform-admin.
- Teste (CRUD + validação de limits/features).

## Fora de escopo

- Stripe/checkout (fora desta fase). Assinatura por tenant (F26-S04). UI (F26-S08).

## Arquivos permitidos

- `apps/api/src/routes/platform/plans.ts`
- `apps/api/src/routes/platform/plans.test.ts`

## Arquivos proibidos

- `apps/api/src/app.ts`, outros `routes/platform/*`

## Definition of Done

- [ ] CRUD de planos com limits/features tipados; soft-delete por is_active; nenhuma chamada Stripe.
- [ ] Gated por platform-admin; mudanças em `audit_logs`.
- [ ] `pnpm --filter @hm/api test` + lint/typecheck verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**. Exporta `createPlatformPlansRouter()` p/ wire. As chaves tipadas de limits/features viram contrato compartilhado com F26-S04 (resolveEntitlements) — defina-as num módulo reusável dentro de `routes/platform/` ou `services/platform/`.
