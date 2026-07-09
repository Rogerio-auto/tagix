---
id: F56-S03
title: Campanhas — máquina de estados do recipient (drip + completed + teto diário)
phase: F56
status: available
priority: high
estimated_size: M
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
---

# F56-S03 — Campanhas: drip multi-passo + estado terminal + teto diário (CAMP-03/04/06)

> **Origem:** AUDITORIA_TECNICA.md §3.4. Drip só envia o 1º passo (`delaySeconds` nunca é lido; recipient trava em `sending`); campanha nunca vira `completed` (loop infinito de tick 60s); `dailyLimit` nunca é aplicado.

## Objetivo

Fazer campanhas multi-passo enviarem todos os steps com o atraso configurado, marcarem estado terminal ao esgotar, e respeitarem o teto diário de envios.

## Contexto / causa raiz (verificada)

- **CAMP-03:** após o 1º dispatch o recipient vira `sending` e nunca volta a `pending`; `pendingRecipients` só seleciona `pending`. `campaign_steps.delaySeconds` não é lido em nenhum lugar do worker.
- **CAMP-04:** ao esgotar steps o código só faz `continue`; nada marca recipient/campanha `completed`; a campanha segue `running` reagendada a cada 60s.
- **CAMP-06:** `dailyLimit`/`messagesSentToday`/`lastDailyResetAt` existem no schema mas nunca são lidos/escritos.

## Escopo (faz)

- Máquina de estados por recipient: agendar o próximo passo em `last_step_at + delaySeconds` (coluna `next_step_at` ou tabela de agendamento); transição `sending → pending/awaiting` após confirmação; `completed` ao esgotar steps.
- Ao fim do batch: se `count(pending|sending) == 0` → `campaigns.status='completed'`, `nextTickAt=null`.
- Aplicar/decrementar cota diária com reset por `lastDailyResetAt`; parar o batch ao atingir `dailyLimit`.
- Índice `ON campaigns (next_tick_at) WHERE status='running'` (mover DB-04 para cá, dono de `campaigns.ts`).
- Migration `packages/db/drizzle/0061_f56_campaign_steps_state.sql` (colunas + índice).

## Escopo (não faz)

- Métricas/recompute e read-receipt (F56-S02 — `recompute/**`, `inbound/status.ts`, disjunto).
- Segment builder, preview, templates (Épico 7).

## Arquivos permitidos

- `apps/workers/src/campaigns/tick.ts`
- `apps/workers/src/campaigns/db-ports.ts`
- `apps/workers/src/campaigns/steps/**`
- `packages/db/src/schema/campaigns.ts`
- `packages/db/drizzle/0061_f56_campaign_steps_state.sql`

## Arquivos proibidos

- `apps/workers/src/campaigns/recompute/**` · `apps/workers/src/inbound/status.ts` (F56-S02)
- `packages/db/drizzle/meta/**` (regenerado no integração)

## Definition of Done

- [ ] Campanha drip de 2+ passos envia todos os passos respeitando `delaySeconds` (teste).
- [ ] Recipient e campanha chegam a `completed`; campanha some de "Em execução".
- [ ] `dailyLimit` interrompe o batch e reseta por dia.
- [ ] RLS mantida; migration idempotente.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/workers test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

- Reusar o padrão de `scheduled_followups` (claim atômico + backoff) já existente para o agendamento do próximo passo.
- `meta/_journal.json` é regenerado pelo integrador — não commitar aqui (evita colisão com outros slots de migration).
