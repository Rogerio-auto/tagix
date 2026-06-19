---
id: F42-S01
title: Pacote @hm/payments (IPaymentProvider + AbacatePay + Mock + HMAC)
phase: F42
status: available
priority: critical
estimated_size: M
depends_on: []
blocks: [F42-S03, F42-S04, F42-S05, F42-S07]
agent_id: backend-engineer
source_docs:
  - docs/features/PAYMENTS_ABACATEPAY.md
---

# F42-S01 — Pacote @hm/payments

> **source_docs:** `docs/features/PAYMENTS_ABACATEPAY.md` §1/§3/§9
> **blocks:** F42-S03, F42-S04, F42-S05, F42-S07

## Objetivo

Novo pacote leaf `@hm/payments` com o gateway de pagamento atrás de uma interface: `IPaymentProvider`,
o adapter real `AbacatePayProvider` (client HTTP tipado contra `api.abacatepay.com/v2`), um
`MockPaymentProvider` determinístico (dev/testes sem rede) e `verifyWebhookSignature` (HMAC). Nenhuma
dependência de DB/Express — pacote puro, plugável.

## Contexto

Fundação da F42. Mantém a troca de gateway isolada do resto (ADR-consistente com `IAuthProvider`).
Todo slot downstream (webhook, checkout, worker, assistido) consome esta interface.

## Escopo (faz)

- `IPaymentProvider`: `ensureProduct`, `ensureCustomer`, `createHostedCheckout`, `createSubscription`
  (cartão), `createPixCharge` (PIX por ciclo), `cancelSubscription`, `getSubscription`.
- `AbacatePayProvider`: client com `Authorization: Bearer`, timeout/retry, parse do envelope
  `{ data, success, error }`, erros normalizados (`PaymentProviderError`). Valores em centavos/BRL.
- Contratos Zod de request/response por endpoint usado (checkouts, subscriptions, products,
  customers, transparents/pix).
- `MockPaymentProvider` determinístico.
- `verifyWebhookSignature(rawBody: Buffer|string, signature, secret)` (HMAC) + testes.
- `package.json`/`tsconfig.json`/`vitest.config.ts` no padrão de `packages/channels`.

## Fora de escopo

- Schema/DB (F42-S02). Rotas/wiring (F42-S03/S04). Worker (F42-S05). UI (F42-S06/S08).
- Cupons/payouts/trustMRR.

## Arquivos permitidos

- `packages/payments/**`

## Arquivos proibidos

- `packages/db/**`, `apps/**`

## Contratos de saída

- Exporta `IPaymentProvider`, `AbacatePayProvider`, `MockPaymentProvider`,
  `verifyWebhookSignature`, tipos/erros e os schemas Zod.

## Definition of Done

- [ ] Interface + adapter real + mock + HMAC implementados e tipados (zero `any`, `unknown`+Zod).
- [ ] Testes unit do mock e do `verifyWebhookSignature` (assinatura válida/ausente/mismatch) passam.
- [ ] `pnpm --filter @hm/payments test` + typecheck + lint verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/payments test
```

## Notas

- Especialista: **backend-engineer**. Shapes exatos da AbacatePay (`v2`, nomes de campos) devem ser
  conferidos contra a doc/sandbox; deixar os Zod fáceis de ajustar. Nunca logar a API key nem o secret.
