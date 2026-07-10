---
id: F56-S02
title: Campanhas — fechar o loop de métricas (delivery status → metrics)
phase: F56
status: done
priority: critical
estimated_size: M
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
completed_at: 2026-07-10T03:31:02Z

---
# F56-S02 — Campanhas: loop de métricas real (CAMP-01/CAMP-02)

> **Origem:** AUDITORIA_TECNICA.md §3.4. `campaign_metrics` só é semeado; o painel mostra zero para sempre. `campaign_deliveries` nunca sai de `queued` porque o read-receipt atualiza só `messages`, não a delivery.

## Objetivo

Fazer o painel de monitoramento de campanhas mostrar entrega/leitura/resposta reais, propagando o status do read-receipt para `campaign_deliveries` e recomputando `campaign_metrics` periodicamente.

## Contexto / causa raiz (verificada)

- **CAMP-02:** `apps/workers/src/inbound/status.ts` atualiza `messages.view_status/delivered_at/read_at` mas **não toca `campaign_deliveries`**, apesar de `campaign_deliveries.message_id` existir. Colunas `sentAt/deliveredAt/readAt` da delivery ficam nulas.
- **CAMP-01:** nenhum job atualiza `campaign_metrics` (só o seed de `totalRecipients` em `lifecycle.ts:58`). O rate adaptativo que lê `deliveryRate` recebe sempre `null`.

## Escopo (faz)

- Em `inbound/status.ts`: após atualizar a mensagem, propagar o status para `campaign_deliveries` casando por `message_id` (`sent`/`delivered`/`read` + timestamps).
- Novo **job de recompute** (`apps/workers/src/campaigns/recompute/**`): tick (30–60s, singleton via lock Redis existente) que agrega `campaign_deliveries` por status → grava `messagesSent/Delivered/Read/Replied/Failed`, rates e `healthStatus` em `campaign_metrics` (fórmulas em `docs/features/CAMPAIGNS.md`).
- Ajustar `apps/api/src/routes/campaigns/metrics.ts` se necessário para expor os campos recomputados.

## Escopo (não faz)

- Máquina de estados do recipient / drip / teto diário (F56-S03 — `campaigns/{tick,db-ports}.ts`, disjunto).
- Registro de conversão atribuída (fica em F56-S03 via reply).

## Arquivos permitidos

- `apps/workers/src/campaigns/recompute/**`
- `apps/workers/src/inbound/status.ts`
- `apps/api/src/routes/campaigns/metrics.ts`

## Arquivos proibidos

- `apps/workers/src/campaigns/tick.ts` · `apps/workers/src/campaigns/db-ports.ts` (F56-S03)
- `apps/workers/src/main.ts` (F56-S17 registra o novo tick — exporte um `startCampaignRecompute()` e sinalize em COMMS)

## Definition of Done

- [ ] Read-receipt de uma mensagem de campanha marca a `campaign_delivery` correspondente `delivered`/`read`.
- [ ] Job de recompute preenche `campaign_metrics` com números reais; painel deixa de mostrar zero.
- [ ] `deliveryRate` deixa de ser nulo (rate adaptativo passa a poder throttlar).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/workers test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

- O tick novo precisa ser iniciado no bootstrap (F56-S17 possui `bootstrap/**`+`main.ts`). Exporte a função de start e registre a necessidade em `tasks/COMMS.md`; **não** edite `main.ts` aqui.
