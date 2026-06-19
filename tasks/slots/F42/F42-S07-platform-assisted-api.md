---
id: F42-S07
title: Plataforma assistida — gerar cobrança/checkout para um tenant (API)
phase: F42
status: blocked
priority: medium
estimated_size: S
depends_on: [F42-S01, F42-S04]
blocks: [F42-S08, F42-S09]
agent_id: backend-engineer
source_docs:
  - docs/features/PAYMENTS_ABACATEPAY.md
  - docs/features/PLATFORM_TENANT_MANAGEMENT.md
---

# F42-S07 — Cobrança assistida (API de plataforma)

> **source_docs:** `docs/features/PAYMENTS_ABACATEPAY.md` §7; `PLATFORM_TENANT_MANAGEMENT.md` §5.2
> **blocks:** F42-S08, F42-S09

## Objetivo

Estender a API de plataforma da F26 para o super-admin gerar um link de checkout/assinatura **real**
para um tenant (cobrança de verdade por trás), reusando o provider do F42-S04.

## Contexto

Hoje `routes/platform/subscriptions.ts` (F26-S04) troca plano/status na mão, sem cobrança. Este slot
adiciona o endpoint que dispara cobrança via `getPaymentProvider()` (S04), gated por `requirePlatformAdmin`.

## Escopo (faz)

- Em `apps/api/src/routes/platform/subscriptions.ts`: `POST /api/platform/tenants/:id/billing/checkout`
  — gera checkout hospedado para o tenant (plano+ciclo+método), retorna `redirectUrl`/link. Auditado
  (before/after, `updated_by`).
- Teste do endpoint (authz platform-admin; geração via mock provider).

## Fora de escopo

- UI do Workspace 360 (F42-S08). Webhook/transições (S03). Self-serve (S04).

## Arquivos permitidos

- `apps/api/src/routes/platform/subscriptions.ts`
- `apps/api/src/routes/platform/subscriptions.test.ts`

## Arquivos proibidos

- `apps/api/src/app.ts`, `apps/api/src/routes/billing/**`, `apps/api/src/routes/webhooks/**`

## Definition of Done

- [ ] Endpoint gera checkout para o tenant via provider; gated por `requirePlatformAdmin`; auditado.
- [ ] `pnpm --filter @hm/api test` + typecheck + lint verdes.

## Permission scope

- Apenas super-admin de plataforma (`requirePlatformAdmin`). Ver `docs/features/PERMISSIONS.md` (nível plataforma).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**. O router já é montado no `app.ts` (F26) — **não** editar `app.ts`.
  Reusar `getPaymentProvider()` exportado pelo S04 (sem duplicar client).
