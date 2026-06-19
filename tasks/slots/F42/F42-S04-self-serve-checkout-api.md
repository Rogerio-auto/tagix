---
id: F42-S04
title: API self-serve (checkout hospedado + subscription + cancel + plan↔product sync)
phase: F42
status: done
priority: critical
estimated_size: M
depends_on: [F42-S01, F42-S02]
blocks: [F42-S06, F42-S07, F42-S09]
agent_id: backend-engineer
source_docs:
  - docs/features/PAYMENTS_ABACATEPAY.md
---

# F42-S04 — API self-serve de billing

> **source_docs:** `docs/features/PAYMENTS_ABACATEPAY.md` §5/§9
> **blocks:** F42-S06, F42-S07, F42-S09

## Objetivo

Rotas de billing do produto (dentro do `withWorkspace`) para o tenant assinar/trocar de plano via
**checkout hospedado** (CARD+PIX), consultar a assinatura e cancelar. Inclui o sync plano↔product
AbacatePay e o wiring no `app.ts`.

## Contexto

Consome `@hm/payments` (S01) e o schema (S02). É o único slot da F42 que edita `app.ts` (monta o
router de billing). O webhook (S03) é quem confirma o pagamento; aqui só iniciamos o fluxo.

## Escopo (faz)

- `apps/api/src/routes/billing/index.ts`:
  - `POST /api/billing/checkout` — valida plano+ciclo+método **server-side** (preço nunca do cliente),
    garante product+customer, cria checkout hospedado, retorna `redirectUrl`. `metadata`/`externalId`
    carregam `workspaceId`+`planId`.
  - `GET /api/billing/subscription` — estado atual (plano, status, método, próximo vencimento, histórico via `payment_events`).
  - `POST /api/billing/cancel` — cartão: `cancelSubscription`; PIX: `cancel_at_period_end=true`.
- `apps/api/src/services/billing/provider.ts` — factory que escolhe `AbacatePayProvider` vs
  `MockPaymentProvider` por env (`ABACATEPAY_API_KEY`).
- `apps/api/src/services/billing/plan-sync.ts` — garante o `product` AbacatePay para um plano (idempotente).
- Wiring em `apps/api/src/app.ts` (montar `createBillingRouter()`).
- Testes (checkout cria sessão via mock; cancel; authz workspace).

## Fora de escopo

- Webhook/transições (F42-S03). Worker PIX (F42-S05). UI (F42-S06). Plataforma assistida (F42-S07).

## Arquivos permitidos

- `apps/api/src/routes/billing/index.ts`
- `apps/api/src/routes/billing/billing.test.ts`
- `apps/api/src/services/billing/provider.ts`
- `apps/api/src/services/billing/plan-sync.ts`
- `apps/api/src/app.ts`

## Arquivos proibidos

- `apps/api/src/routes/webhooks/**`, `apps/api/src/services/billing/transitions.ts`,
  `apps/api/src/routes/platform/**`

## Contratos de saída

- `POST /billing/checkout` → `{ redirectUrl }`. `GET /billing/subscription` → estado.
  Exporta `createBillingRouter()` e `getPaymentProvider()` (reusado pelo S07).

## Definition of Done

- [ ] Checkout/subscription/cancel funcionam contra o `MockPaymentProvider`; preço validado server-side.
- [ ] Escopado por workspace (não vaza entre tenants); inputs validados com Zod.
- [ ] Router montado no `app.ts`; `pnpm --filter @hm/api test` + typecheck + lint verdes.

## Permission scope

- Produto, dentro do `withWorkspace` — roles que gerenciam billing do workspace (OWNER/ADMIN).
  Ver `docs/features/PERMISSIONS.md §2`.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**. `getPaymentProvider()` é a porta única; o S07 (assistido) reusa.
