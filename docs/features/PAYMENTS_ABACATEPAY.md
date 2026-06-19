# PAYMENTS_ABACATEPAY — Integração de Pagamentos (AbacatePay)

> Status: aprovado (2026-06-19). Fase de execução: **F42**.
> Origem: plano aprovado pelo fundador nesta sessão. Reusa o billing interno da F26
> (`PLATFORM_TENANT_MANAGEMENT.md` §5.2/§5.3) — esta feature pluga **cobrança real**
> por cima daquele modelo, sem substituí-lo.

## 1. Princípios

- **Merchant único = Leadium.** Uma conta AbacatePay para todo o SaaS; os tenants pagam a
  Leadium. A API key é **segredo de plataforma** (`ABACATEPAY_API_KEY` em `.env`/secret de
  serviço), nunca por-tenant, nunca commitada.
- **Provider atrás de interface.** `IPaymentProvider` + `AbacatePayProvider` + `MockPaymentProvider`.
  Trocar de gateway (ou rodar testes/dev sem rede) não vaza para o resto do sistema. ADR-consistente
  com `IAuthProvider`/adapters de canal.
- **Webhook assinado é a fonte da verdade do pagamento.** `returnUrl`/`completionUrl` só melhoram
  UX; quem transiciona `subscription_status` é **sempre** o webhook HMAC-verificado + idempotência.
- **Não reinventa o billing interno.** Fonte da verdade do status continua sendo
  `workspaces.{plan_id,subscription_status,trial_ends_at}` + `subscriptions` + `resolveEntitlements`.
- **Dinheiro em centavos, BRL.** API AbacatePay `https://api.abacatepay.com/v2`, auth
  `Authorization: Bearer`, envelope `{ data, success, error }`. Versão/shapes exatos a confirmar
  contra a doc/sandbox antes de fechar os contratos Zod (o `llms.txt` é índice resumido).

## 2. Modelo de dados

As tabelas `plans`/`subscriptions` já existem (F26) e trazem colunas `stripe_*` de scaffold —
tratadas como **legado, não usadas** por esta feature. Adicionamos colunas provider-agnósticas:

- `plans.payment_provider_product_id text` — id do `product` AbacatePay correspondente (sync via
  `externalId = plan.id`); usado para assinatura nativa (cartão).
- `subscriptions.payment_provider text` (`abacatepay`), `external_customer_id`,
  `external_subscription_id`, `external_product_id`, `payment_method` (`card | pix`).
  Reaproveita `current_period_start/end`, `cancel_at_period_end`, `canceled_at` já existentes.
- Nova `payment_events` (ledger + idempotência de domínio): `id`, `provider`, `external_event_id`
  (único), `event_type`, `workspace_id`, `subscription_external_id`, `amount_cents`, `status`,
  `raw_payload jsonb`, `received_at`, `processed_at`. Workspace-scoped onde aplicável → RLS.
  A dedup de **borda** (HTTP) continua em `webhook_events` (`provider='abacatepay'`).

## 3. `@hm/payments`

- `IPaymentProvider`: `ensureProduct(plan)`, `ensureCustomer(workspace)`,
  `createHostedCheckout({ planId, cycle, method, workspace, returnUrl, completionUrl })`,
  `createSubscription(...)` (cartão), `createPixCharge(...)` (PIX por ciclo),
  `cancelSubscription(externalId)`, `getSubscription(externalId)`.
- `AbacatePayProvider`: client HTTP tipado (timeout/retry/erros normalizados), contratos Zod de
  request/response, parse do envelope `{ data, success, error }`.
- `MockPaymentProvider`: determinístico, sem rede (dev/testes).
- `verifyWebhookSignature(rawBody, signature, secret)`: HMAC; rejeita ausência/mismatch.

## 4. Webhook & transições

`POST /api/webhooks/abacatepay` (dentro de `routes/webhooks/`, **antes** do `express.json` para
raw body). Verifica HMAC → dedup (`webhook_events` + `payment_events`) → mapeia evento → transição:

| Evento AbacatePay                          | Transição                              |
|--------------------------------------------|----------------------------------------|
| `checkout.completed` / `subscription.completed` | `active` (+ entitlements do plano) |
| `subscription.renewed`                     | mantém `active`, avança `current_period_end` |
| `subscription.cancelled`                   | `canceled`                             |
| `*.refunded` / `*.disputed` / `*.lost`     | `past_due` / revisão (auditado)        |
| (PIX vencido sem pagamento — via worker)   | `past_due` → corte                     |

Toda transição grava `audit_logs` (before/after) + `payment_events.processed_at`.

## 5. Self-serve checkout (hosted)

- `POST /api/billing/checkout` (produto, `withWorkspace`): valida plano+ciclo server-side (preço
  **nunca** vem do cliente), garante product+customer, cria **checkout hospedado** (methods
  `CARD`+`PIX`), retorna `redirectUrl`. `externalId`/`metadata` carregam `workspaceId` + `planId`.
- `GET /api/billing/subscription`: estado atual (plano, status, método, próximo vencimento, histórico).
- `POST /api/billing/cancel`: cartão → cancela na AbacatePay; PIX → `cancel_at_period_end=true`.

## 6. Recorrência

- **Cartão:** assinatura nativa AbacatePay (`cycle` no product); renova sozinha → ouvimos
  `subscription.renewed`.
- **PIX:** sem débito automático. Worker (in-process scheduler dos workers) varre assinaturas PIX
  perto do `current_period_end`, gera a cobrança do próximo ciclo e aplica **régua de dunning**
  (lembrete → tolerância → `past_due` → corte). Idempotente por ciclo.

## 7. Fluxo assistido (plataforma)

Estende a API de plataforma da F26 (`routes/platform/subscriptions.ts`): super-admin gera um link de
checkout/assinatura para um tenant a partir do Workspace 360 — agora com **cobrança real** por trás
(não libera acesso de graça). Gated por `requirePlatformAdmin`, auditado.

## 8. Billing portal (web)

Em `settings/billing` (produto, DS v2 dark-first): planos/upgrade self-serve → redireciona ao
checkout hospedado → volta e mostra status; assinatura atual (plano, método, próximo vencimento,
histórico), cancelar. Banners de `trial`/`past_due` reusando o status existente.

## 9. Segurança

Key só em `.env`/secret de serviço; HMAC obrigatório (rejeita sem assinatura); idempotência por
event id; preço/plano sempre reconferidos server-side; toda transição auditada; Zod em todo input
externo (inclusive payload do webhook); webhook sem auth de sessão mas com assinatura.

## 10. Seams (explícitos, dependem de infra/conta)

- **Cobrança real E2E** exige a **key de produção** + registrar o webhook HTTPS na conta AbacatePay
  (`webhooks/create`) quando a VPS tiver URL pública.
- **Confirmar contra doc/sandbox** os shapes exatos (`v2`, campos) antes de fechar os Zod.
- Cupons/payouts/trustMRR: fora de escopo (plugáveis depois).
