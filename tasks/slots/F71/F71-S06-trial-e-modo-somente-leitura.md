---
id: F71-S06
title: Trial expira em 15 dias e empresa sem assinatura ativa fica só leitura
phase: F71
status: review
priority: high
estimated_size: M
depends_on: [F71-S01, F71-S03]
blocks: [F71-S08]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/features/PLATFORM_TENANT_MANAGEMENT.md
agent_id: backend-engineer
claimed_at: 2026-10-05T17:08:21Z
completed_at: 2026-10-05T17:10:22Z

---
# F71-S06 — Trial e modo só leitura

## Objetivo

O trial termina sozinho no dia certo. Empresa com assinatura `expired` ou `canceled` continua vendo tudo, mas não edita, e as automações de saída param. Mensagens que chegam continuam sendo recebidas.

## Contexto

A6 da spec, decisões §3.3 e §3.4. O worker de cobrança (`apps/workers/src/billing/recurrence.ts`) já move empresas Pix para `past_due`/`canceled` e diz "acesso revogado", mas nada na API lê esse status.

## Escopo (faz)

- Worker de cobrança: transição `trial → expired` quando `trial_ends_at <= now`. Mesmas garantias da recorrência: idempotente, sob o lock do worker e com auditoria `billing.trial_expired`. Atualiza `subscriptions.status` e `workspaces.subscription_status`.
- API: guarda `requireActiveSubscription` aplicada depois do `requireAuth`, no próprio `middlewares/auth.ts` (dentro de `withRLS`, para cobrir toda rota escopada sem tocar `app.ts`):
  - `expired`/`canceled` + método mutável → `402 { error: 'subscription_inactive' }`;
  - liberadas: `/api/billing/**`, `/api/me` e `/api/me/workspace`, preferências do próprio member, `/auth/**`, logout;
  - `past_due` e `trial` passam.
- `/api/me` expõe `workspace.subscriptionStatus` e `trialEndsAt` (já vêm no workspace; conferir).
- Workers de saída checam a empresa ativa antes de agir: turno do agente IA, disparo de campanha, passo de flow e lembrete de agenda. Empresa inativa → o job é concluído como `skipped_subscription_inactive`, sem retry e sem enviar. O inbound não muda.
- Testes de cada caminho.

## Fora de escopo

- Banner e CTA na UI (S08). Mudar `@hm/payments`.

### files_allowed

- `apps/workers/src/billing/**`
- `apps/workers/src/agents/**`, `apps/workers/src/campaigns/**`, `apps/workers/src/flows/**`, `apps/workers/src/calendar-reminders/**` (só a checagem de assinatura + testes)
- `apps/workers/src/lib/subscription-gate.ts` (novo, se fizer sentido compartilhar)
- `apps/api/src/middlewares/auth.ts`, `apps/api/src/middlewares/subscription-guard.ts` (novo), `apps/api/src/middlewares/subscription-guard.test.ts`

### files_forbidden

- `packages/db/**` (S01), `apps/api/src/auth/**` (S03/S04/S05)

## Definition of Done

- [ ] teste: trial vencido vira `expired` e rodar de novo não faz nada
- [ ] teste: POST em empresa `expired` → 402; GET → 200; billing → 200
- [ ] teste: turno de IA, campanha e passo de flow não enviam com empresa `expired`
- [ ] teste: inbound continua gravando mensagem
- [ ] métricas e log do worker com contagem de `trial_expired`

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/middlewares --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/billing src/agents src/campaigns src/flows src/calendar-reminders --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`.
- `middlewares/auth.ts` também é tocado pela S03; esta slot só começa após o merge da S03.
- Risco de produção: o backfill da S01 dá 15 dias a toda empresa `trial`. Antes do deploy, o Rogério confirma quais são clientes reais e estende pelo painel.

## Notas de execução

- **Regra única de status** (API e workers): `workspaces.subscription_status`, com `trial` +
  `trial_ends_at <= agora` valendo `expired` mesmo antes do tick de cobrança (que é de hora em
  hora). Inativos: `expired`, `canceled`. `trial` no prazo/sem data, `active` e `past_due` passam.
  A função está duplicada em `apps/api/src/middlewares/subscription-guard.ts` e
  `apps/workers/src/lib/subscription-gate.ts` porque `packages/**` é proibido aqui; candidata a
  subir para `@hm/shared` num slot que possa tocar o pacote.
- **API — `requireActiveSubscription`** (`middlewares/subscription-guard.ts`), chamado no fim do
  `withRLS` (`middlewares/auth.ts`). Mapa feito: todo router escopado por empresa usa
  `requireAuth` + `withRLS` (únicos sem `withRLS`: router de auth, rotas de leitura da Central de
  Ajuda e os routers de plataforma, que não são escopo de tenant). Sem consulta extra: lê
  `req.auth.workspace`, que o `requireAuth` acabou de carregar do banco. GET/HEAD/OPTIONS passam;
  sob view-as (`req.impersonation`) a guarda sai do caminho (o middleware de impersonation já
  responde 403 a escrita antes). Escrita em empresa inativa → `402 { error: 'subscription_inactive', message }`.
- **Exceções (método + caminho, case-insensitive, sem query):** qualquer método em `/auth/**`,
  `/api/billing/**`, `/api/me` e `/api/me/**`, `/api/push/**`, `/api/support/**`;
  `PATCH /api/members/me`, `PATCH /api/members/me/dashboard-layout`, `POST /api/members/me/password`,
  `DELETE /api/members/me/sessions/:id` (logout), `POST /api/conversations/:id/read`,
  `POST /api/privacy/exports` (portabilidade LGPD). `DELETE /api/members/me` NÃO é exceção (cairia
  em `DELETE /api/members/:id`). Push, suporte, marcar como lida e export LGPD são além da lista
  travada — decisão de julgamento (bloqueado precisa falar com o suporte; ler marca lida;
  portabilidade é leitura); remover é uma linha em `EXEMPT_RULES`.
- **`/api/me`** (router de auth, `auth/routes.ts`): já devolve `workspace` = linha inteira de
  `workspaces`, logo `workspace.subscriptionStatus` e `workspace.trialEndsAt` vêm. Coberto por
  teste (`subscription-guard.test.ts`). `memberships[]` traz `subscriptionStatus` de cada empresa
  (S03), sem `trialEndsAt`.
- **Workers — portão** (`lib/subscription-gate.ts`): uma consulta por PK em `workspaces` por job,
  sem cache entre jobs (um TTL abriria a janela "pagou e continua parado"/"expirou e continua
  enviando"; o custo é desprezível perto de LLM/provedor). Nos ticks que varrem vários itens da
  mesma empresa, memo só durante o tick. Empresa inexistente → inativa (fail-closed). Desfecho
  canônico `skipped_subscription_inactive`; métrica
  `hm_worker_subscription_inactive_skipped_total{worker,status}` + log `info` com `outcome`.
  - turno do agente (`agents/run.ts`): primeira coisa do `runAgent` (antes do `loadContext`);
    `AgentRunDeps.subscription` é obrigatório; outcome `{ skipped, reason: 'subscription_inactive' }`, ack sem retry.
  - follow-up e reengajamento de IA: empresa pulada no tick antes da marca Redis (a janela fica
    livre) e, no reengajamento, sem religar `ai_mode`.
  - campanha (`campaigns/tick.ts`): port `checkSubscription` antes de tudo; campanha vai para
    `paused` (sai do loop; o cliente retoma depois de assinar). Follow-up de campanha
    (`campaigns/followups.ts`): item `cancelled` com `failed_reason = skipped_subscription_inactive`.
  - passo de flow (`flows/worker.ts`): execução `cancelled` via `engine.cancelFlowExecution`
    (`last_error = skipped_subscription_inactive`), terminal para o wakeup/recuperação não
    republicarem em loop.
  - lembrete de agenda: organizador ainda é avisado no app (leitura da própria agenda); WhatsApp ao
    contato e ação de vencimento não rodam; marcas gravadas (sem retry, sem rajada depois).
  - inbound: não importa o portão (teste estrutural) e grava mensagem com empresa `expired` (teste DB).
- **Cobrança — fim do trial** (`billing/recurrence.ts`): `expireTrials` dentro do
  `runRecurrenceTick`, sob o mesmo lock, depois da régua PIX. Enumera `workspaces` `trial` com
  `trial_ends_at <= now`; por empresa, numa transação RLS: UPDATE condicional de `workspaces`
  (`status='trial' and trial_ends_at <= now`), `subscriptions` `trial → expired` e auditoria
  `billing.trial_expired` (actor `system`, metadata `from/to/trialEndsAt/subscriptionIds`). Re-rodar
  ou correr contra extensão de trial = no-op, sem auditoria duplicada. Métrica
  `hm_billing_trial_expired_total`; `trialExpired` no resultado e no log do tick.
- **Lacuna fora do escopo:** a API pública `/api/v1/**` (API key, sem `withRLS`) — `send_message`,
  `send_template`, `trigger_flow`, `upsert_contact` etc. — não passa pela guarda; `send_message`
  enfileira outbound direto, e o worker de outbound não é gateado. Precisa de slot que toque
  `middlewares/api-key.ts`/`routes/v1` (ou o worker de outbound).

### Validação (2026-10-05)

- `pnpm --filter @hm/api typecheck` → ok. `pnpm --filter @hm/workers typecheck` → ok.
- `vitest run src/middlewares` (api) → 6 arquivos, 63 testes, 0 falhas.
- `vitest run src/billing src/agents src/campaigns src/flows src/calendar-reminders` (workers) →
  35 arquivos, 341 testes, 0 falhas. `src/lib` → 1 arquivo, 10 testes. Suíte inteira de workers →
  79 arquivos, 760 testes, 0 falhas.
- Regressão api: `src/services/billing src/routes/billing src/routes/members src/routes/contacts` → 6 arquivos, 48 testes, 0 falhas.
- `npx eslint` nos 29 arquivos tocados → 0 problemas.
