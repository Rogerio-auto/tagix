---
id: F71-S06
title: Trial expira em 15 dias e empresa sem assinatura ativa fica só leitura
phase: F71
status: in-progress
priority: high
estimated_size: M
depends_on: [F71-S01, F71-S03]
blocks: [F71-S08]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/features/PLATFORM_TENANT_MANAGEMENT.md
agent_id: backend-engineer
claimed_at: 2026-10-05T17:08:21Z

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
