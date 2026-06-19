# Runbook — Pagamentos AbacatePay (F41)

> Caminho do dinheiro. Toda alteracao aqui afeta cobranca real. Leia inteiro antes de mexer.
> Spec: `docs/features/PAYMENTS_ABACATEPAY.md` (secao 9 seguranca, secao 10 seams).

## 1. Visao geral do fluxo

- **Merchant unico = Leadium.** Uma unica conta AbacatePay para todo o SaaS. A API key e
  **segredo de plataforma** (`ABACATEPAY_API_KEY`), nunca por-tenant, nunca commitada.
- **Provider atras de interface** (`@hm/payments`): com a key setada usa o `AbacatePayProvider`
  real; sem ela cai no `MockPaymentProvider` (dev/testes, sem rede).
- **Webhook HMAC e a fonte da verdade do pagamento.** `returnUrl`/`completionUrl` so melhoram
  UX; quem transiciona `subscription_status` e sempre o webhook assinado + idempotencia.
- **Preco/plano sempre server-side.** O cliente so manda `planId`/`cycle`/`method`; o valor vem
  do catalogo `plans`. Nada de valor vindo do body ou do payload do gateway.

## 2. Variaveis de ambiente

| Variavel | Onde | Obrigatoria | Descricao |
|---|---|---|---|
| `ABACATEPAY_API_KEY` | api, workers | Para cobranca real | API key da conta AbacatePay. Ausente/vazia entao MockPaymentProvider. Segredo de plataforma. |
| `ABACATEPAY_WEBHOOK_SECRET` | api | Para cobranca real | Segredo HMAC do webhook. Sem ele, todo webhook e rejeitado com 401 (fail-closed). |
| `BILLING_ENABLED` | api, web | Nao | Flag de exposicao do billing portal. Nao desliga o webhook. |
| `APP_PUBLIC_URL` | api | Recomendada | Base usada para montar `returnUrl`/`completionUrl` do checkout. Fallback: `CORS_ORIGIN` e depois `http://localhost:3000`. |
| `BILLING_DUNNING_LEAD_DAYS` | workers | Nao (default 3) | Dias antes do vencimento em que a cobranca PIX do proximo ciclo e gerada. |
| `BILLING_DUNNING_GRACE_DAYS` | workers | Nao (default 3) | Tolerancia apos o vencimento antes de marcar `past_due`. |
| `BILLING_DUNNING_PASTDUE_DAYS` | workers | Nao (default 7) | Dias em `past_due` antes do corte (cancelamento por inadimplencia). |
| `BILLING_PIX_EXPIRES_SECONDS` | workers | Nao (default ~13d) | Validade da cobranca PIX gerada. Deve cobrir lead+grace+pastDue. |

> Os defaults de dunning vivem em `apps/workers/src/billing/recurrence.ts`
> (`DEFAULT_DUNNING_POLICY`). So setar as `BILLING_*` para sobrescrever.

### Sandbox / dev local

No `.env` de dev as duas chaves podem ser placeholders (`abc_dev...`, `dev_...`). Enquanto
`ABACATEPAY_API_KEY` for vazia, o sistema usa o mock e nada sai para a rede. Para exercitar o
adapter real contra a sandbox, preencha a key de sandbox e o secret de webhook de sandbox.

`.env` ja esta no `.gitignore` (`.env`, `.env.*`, exceto os `*.example`). NUNCA coloque uma key
real em `.env.example` nem em `.env.production.example` (sao versionados).

## 3. Trocar para a key de PRODUCAO

1. No painel AbacatePay (conta de producao da Leadium), gere a API key de producao.
2. No servidor (VPS Swarm), edite `/opt/leadium/.env` (NUNCA no repo):

   ```
   ABACATEPAY_API_KEY=<key_de_producao>
   ABACATEPAY_WEBHOOK_SECRET=<secret_forte_gerado>
   ```

   Gere o secret forte com: `openssl rand -base64 36` (e remova caracteres nao alfanumericos).
3. Re-deploy dos servicos `api` e `workers` para carregar as novas envs.
4. Valide o boot: o provider e selecionado por env no primeiro `getPaymentProvider()` (memoizado
   por processo). Se a key estava ausente no boot, o processo fica preso no mock ate reiniciar —
   por isso o re-deploy e obrigatorio, nao basta editar o arquivo.

> O `ABACATEPAY_WEBHOOK_SECRET` deve ser identico ao secret registrado em `webhooks/create`
> (secao 4). Se divergir, todos os webhooks caem em 401 e nenhuma assinatura ativa.

## 4. Registrar o webhook HTTPS na conta AbacatePay

Pre-requisito (seam de infra, secao 10): a VPS precisa ter URL publica HTTPS apontando para a
API. O endpoint e `POST https://<dominio-publico>/webhooks/abacatepay` (montado ANTES do
`express.json()` para preservar o raw body do HMAC).

Registre o webhook na conta (uma vez), via `POST /webhooks/create` na API AbacatePay:

```
curl -X POST https://api.abacatepay.com/v2/webhooks/create \
  -H "Authorization: Bearer $ABACATEPAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "leadium-prod",
    "endpoint": "https://app.leadium.com.br/webhooks/abacatepay",
    "secret": "<MESMO_VALOR_DE_ABACATEPAY_WEBHOOK_SECRET>",
    "events": [
      "checkout.completed",
      "subscription.completed",
      "subscription.renewed",
      "subscription.cancelled",
      "payment.refunded"
    ]
  }'
```

> Os nomes EXATOS de campos/eventos e o header de assinatura (`x-abacatepay-signature`) estao
> marcados `TODO(confirmar)` no codigo (`packages/payments/src/abacatepay/schemas.ts`,
> `webhook.ts`). Confirme contra a doc/sandbox antes do go-live e ajuste o mapa de eventos em
> `apps/api/src/services/billing/transitions.ts` (`classifyEvent`) se a nomenclatura diferir.

O verificador (`verifyWebhookSignature`) aceita assinatura hex ou base64, com ou sem prefixo
`sha256=`, e compara em tempo constante. A verificacao roda sobre os bytes brutos recebidos.

## 5. Checklist de validacao na sandbox

Antes de habilitar producao, rode contra a sandbox (key + webhook de sandbox):

- [ ] **Selecao de provider:** com `ABACATEPAY_API_KEY` setada, `getPaymentProvider()` retorna o
      `AbacatePayProvider` (logs de boot nao revelam a key).
- [ ] **Checkout self-serve:** `POST /api/billing/checkout` (OWNER) retorna `redirectUrl` da
      sandbox; o intent (provider/customer/product/method) e gravado na `subscriptions` do
      workspace; o `amountCents` bate com o catalogo `plans` (nunca com o body).
- [ ] **Webhook HMAC obrigatorio:** um POST sem header de assinatura, e outro com assinatura de
      secret errado, ambos retornam 401 e NAO transicionam o status.
- [ ] **Ativacao:** evento `checkout.completed`/`subscription.completed` assinado leva o workspace
      e a subscription a `active`, encerra o trial e grava `audit_logs` (`subscription.activated`).
- [ ] **Renovacao:** `subscription.renewed` mantem `active` e AVANCA `current_period_end`.
- [ ] **Cancelamento:** `subscription.cancelled` leva a `canceled`, carimba `canceled_at` e seta
      `cancel_at_period_end`.
- [ ] **Idempotencia:** reenviar o MESMO evento (mesmo event id) e no-op — nenhuma re-transicao,
      nenhum audit duplicado (dedup de borda em `webhook_events` + dominio em `payment_events`).
- [ ] **Estorno/disputa:** `payment.refunded`/`*.disputed`/`*.lost` leva a `past_due` (revisao).
- [ ] **PIX recorrencia:** com uma assinatura PIX perto do vencimento, o worker gera UMA cobranca
      por ciclo (idempotente por subscription+period); apos grace+pastDue sem pagamento, degrada
      para `past_due` e depois corta (`canceled`).
- [ ] **Cancelamento assistido (plataforma):** `POST /api/platform/tenants/:id/billing/checkout`
      (apenas `requirePlatformAdmin`) gera o link; quem transiciona o status continua sendo o
      webhook. Nao-admin recebe 403; sem sessao recebe 401.
- [ ] **Isolamento multi-tenant:** `GET /api/billing/subscription` so devolve a assinatura do
      proprio workspace (RLS + filtro explicito); workspace sem assinatura devolve `null`.
- [ ] **Sem segredo em logs:** verifique os logs do `api`/`workers` durante o fluxo — nenhuma
      ocorrencia de `ABACATEPAY_API_KEY`/`ABACATEPAY_WEBHOOK_SECRET` nem do raw body sensivel.

## 6. Rotacao de segredo

1. Gere novo `ABACATEPAY_WEBHOOK_SECRET`.
2. Atualize o webhook na conta AbacatePay (`webhooks/update` ou recriar) com o novo secret.
3. Atualize `/opt/leadium/.env` e re-deploy `api`.
4. Janela de troca: enquanto o secret do servidor e o registrado divergirem, webhooks caem em
   401. Faca a troca dos dois lados o mais proximo possivel e monitore reentregas.

## 7. Referencias de codigo

- `packages/payments/**` — provider/mock/HMAC/contratos Zod.
- `apps/api/src/routes/webhooks/abacatepay.ts` — endpoint do webhook (raw body, HMAC, dedup).
- `apps/api/src/services/billing/transitions.ts` — mapa evento -> transicao (server-side).
- `apps/api/src/routes/billing/index.ts` — self-serve (checkout/subscription/cancel/plans).
- `apps/api/src/routes/platform/subscriptions.ts` — checkout assistido (platform-only).
- `apps/workers/src/billing/recurrence.ts` — recorrencia PIX + regua de dunning.
- `packages/db/src/schema/billing.ts` + `packages/db/drizzle/0046_f41_payments.sql` — `payment_events` + RLS.
