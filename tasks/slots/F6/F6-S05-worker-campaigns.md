---
id: F6-S05
title: Worker-campaigns — tick + send window + rate adaptativo + dispatch idempotente + auto-pause RED
phase: F6
status: in-progress
priority: critical
estimated_size: L
depends_on: [F6-S01, F6-S02]
agent_id: backend-engineer
claimed_at: 2026-06-11T05:04:17Z

---
# F6-S05 — Worker-campaigns

> **source_docs:** `docs/features/CAMPAIGNS.md` §6, §7, §8.1, §8.2, §10; `docs/ROADMAP.md` F6-S02, F6-S06 (parte handling)
> **blocks:** F6-S06

## Objetivo
Worker que conduz o envio das campanhas: tick 1min com **distributed lock** (reusa `runWithDistributedLock` de `apps/workers/src/lock.ts`), respeita send windows (§6), aplica rate adaptativo por quality (§7), faz dispatch **idempotente** de deliveries (UNIQUE idempotency_key → publish outbound template), e auto-pausa em quality RED (§7) + trata Meta error codes (§10) via o mapa de F6-S02.

## Escopo (faz)
- `apps/workers/src/campaigns/**`: `campaignTick` (lock por campanha), `processCampaignTick` (quality → rate → window → batch), `dispatchCampaignDelivery` (idempotente, publica `outbound.request` template com `metadata.campaignId/deliveryId`), `scheduleNextTick`, `nextWindowStart`.
- Tratamento de status callbacks/erros de delivery (atualiza `campaign_deliveries`/`campaign_metrics`; aplica ação do error map: pause/mark_invalid/etc).
- Registro no bootstrap + scheduler 1min (gap-fill orchestrator, padrão F3).

## Fora de escopo
- Followup processor (F6-S06), opt-out keyword / reply handling (F6-S07), schema (F6-S01), error map (F6-S02).

## Arquivos permitidos
- `apps/workers/src/campaigns/**`

## Definition of Done
- [ ] Tick respeita lock/window/rate; fora da janela reagenda p/ próxima janela sem enviar.
- [ ] Dispatch idempotente (re-tick não duplica delivery); quality RED auto-pausa; error codes aplicam a ação do mapa.
- [ ] `pnpm --filter @hm/workers test` (lock/db/mq mockados) + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Publica via o pipeline outbound existente (F1-S07) — não reimplementa envio Meta. Lock evita 2 instâncias processando a mesma campanha. Slot L — se passar de ~500 linhas, separe o handling de error codes num slot sequencial.
