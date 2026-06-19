---
id: F42-S03
title: Webhook AbacatePay (HMAC + idempotência + transições de status)
phase: F42
status: done
priority: critical
estimated_size: M
depends_on: [F42-S01, F42-S02]
blocks: [F42-S05, F42-S09]
agent_id: backend-engineer
source_docs:
  - docs/features/PAYMENTS_ABACATEPAY.md
---

# F42-S03 — Webhook + transições de status

> **source_docs:** `docs/features/PAYMENTS_ABACATEPAY.md` §4/§9
> **blocks:** F42-S05, F42-S09

## Objetivo

Endpoint público `POST /api/webhooks/abacatepay` que verifica a assinatura HMAC, deduplica, e mapeia
cada evento de pagamento para a transição correta de `workspaces.subscription_status` +
`subscriptions`, gravando ledger (`payment_events`) e `audit_logs`. **Fonte da verdade do pagamento.**

## Contexto

Entra dentro de `routes/webhooks/` (montado **antes** do `express.json`, com raw body para HMAC).
Consome `verifyWebhookSignature` do `@hm/payments` (S01) e `payment_events` (S02).

## Escopo (faz)

- `apps/api/src/routes/webhooks/abacatepay.ts`: handler com raw body; valida HMAC (rejeita 401 sem
  assinatura/mismatch); dedup por `(provider, external_event_id)` em `webhook_events` + `payment_events`;
  responde 200 rápido e idempotente.
- `apps/api/src/services/billing/transitions.ts`: mapa evento→transição (ver §4); atualiza
  `workspaces.{subscription_status,plan_id,trial_ends_at}` + `subscriptions` coerentes; avança
  `current_period_end` em `renewed`; grava `audit_logs` (before/after) e `payment_events.processed_at`.
- Registrar a sub-rota em `apps/api/src/routes/webhooks/index.ts`.
- Testes: assinatura inválida (401), replay (idempotente), cada transição (`completed`/`renewed`/
  `cancelled`/`refunded`).

## Fora de escopo

- Self-serve checkout (F42-S04). Worker PIX (F42-S05). `app.ts` (já monta `createWebhooksRouter`).

## Arquivos permitidos

- `apps/api/src/routes/webhooks/abacatepay.ts`
- `apps/api/src/routes/webhooks/abacatepay.test.ts`
- `apps/api/src/routes/webhooks/index.ts`
- `apps/api/src/services/billing/transitions.ts`
- `apps/api/src/services/billing/transitions.test.ts`

## Arquivos proibidos

- `apps/api/src/app.ts`, `apps/api/src/routes/billing/**`, `apps/api/src/routes/platform/**`

## Contratos de entrada

- Payload AbacatePay assinado (HMAC via `secret`); eventos `checkout.completed`,
  `subscription.completed/renewed/cancelled`, `*.refunded/disputed/lost`.

## Definition of Done

- [ ] HMAC obrigatório; payload sem/má assinatura → 401, sem efeito.
- [ ] Replay do mesmo `external_event_id` é no-op (idempotente).
- [ ] Cada transição reflete em `workspaces`+`subscriptions`+`audit_logs`; `payment_events` gravado.
- [ ] `pnpm --filter @hm/api test` + typecheck + lint verdes.

## Permission scope

- Endpoint público (sem sessão), autenticado por **assinatura HMAC**. Ver `PAYMENTS_ABACATEPAY.md` §9.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**. Espelha o padrão de raw-body/HMAC já usado pelo webhook Meta
  (`routes/webhooks/signature.ts`, `hmac.test.ts`). Nunca confiar em valor de plano/preço vindo no payload.
