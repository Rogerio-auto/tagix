---
id: F42-S02
title: Schema de billing provider-agnóstico + payment_events + RLS + migration
phase: F42
status: done
priority: critical
estimated_size: M
depends_on: []
blocks: [F42-S03, F42-S04, F42-S05]
agent_id: db-engineer
source_docs:
  - docs/features/PAYMENTS_ABACATEPAY.md
---

# F42-S02 — Schema de billing (provider-agnóstico)

> **source_docs:** `docs/features/PAYMENTS_ABACATEPAY.md` §2
> **blocks:** F42-S03, F42-S04, F42-S05

## Objetivo

Adicionar colunas provider-agnósticas em `plans`/`subscriptions` e criar a tabela `payment_events`
(ledger + idempotência de domínio), com migration versionada e RLS coerente.

## Contexto

`plans`/`subscriptions` existem (F26) com colunas `stripe_*` de scaffold — tratadas como **legado,
não removidas neste slot**. A F42 adiciona campos genéricos para o gateway real (AbacatePay).

## Escopo (faz)

- `plans`: `payment_provider_product_id text` (nullable; `externalId = plan.id`).
- `subscriptions`: `payment_provider text`, `external_customer_id text`, `external_subscription_id text`,
  `external_product_id text`, `payment_method text` (`card | pix`, check). Reusa
  `current_period_start/end`, `cancel_at_period_end`, `canceled_at` existentes.
- `payment_events` (nova): `id uuid pk`, `provider text`, `external_event_id text` (único por provider),
  `event_type text`, `workspace_id uuid` (FK, nullable até resolver), `subscription_external_id text`,
  `amount_cents bigint`, `status text`, `raw_payload jsonb`, `received_at`, `processed_at`. Índices:
  único `(provider, external_event_id)`, por `workspace_id`, por `received_at desc`.
- Migration `packages/db/migrations/0046_f41_payments.sql` + RLS para `payment_events`
  (workspace-scoped quando `workspace_id` presente; leitura platform como owner).
- Repo helper em `packages/db/src/repos/payment-events.ts` (insert idempotente, markProcessed, listByWorkspace).

## Fora de escopo

- Remover colunas `stripe_*` (legado; limpeza futura). Lógica de transição (F42-S03). Worker (F42-S05).

## Arquivos permitidos

- `packages/db/src/schema/billing.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/repos/payment-events.ts`
- `packages/db/src/repos/index.ts`
- `packages/db/migrations/0046_f41_payments.sql`
- `packages/db/migrations/meta/**`
- `packages/db/src/rls.test.ts`

## Arquivos proibidos

- `apps/**`, `packages/payments/**`

## Definition of Done

- [ ] Colunas adicionadas + `payment_events` criada; migration aplica limpo.
- [ ] RLS policy criada e testada para `payment_events` (isolamento por workspace).
- [ ] Repo idempotente (insert duplicado de `external_event_id` não duplica linha).
- [ ] `pnpm --filter @hm/db test` + typecheck + lint verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas

- Especialista: **db-engineer**. Próxima migration livre = `0046`. `payment_events` cobre a
  idempotência de **domínio**; a dedup de **borda HTTP** segue em `webhook_events`.
