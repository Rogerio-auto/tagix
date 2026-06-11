---
id: F9-S05
title: Worker-webhooks — event hooks → deliveries + HMAC dispatch + retry exponencial
phase: F9
status: done
priority: high
estimated_size: M
depends_on: [F9-S01]
agent_id: backend-engineer
claimed_at: 2026-06-11T21:56:24Z
completed_at: 2026-06-11T22:00:26Z

---
# F9-S05 — Worker webhooks outbound

> **source_docs:** `docs/DATA_MODEL.md` §14.3; `docs/ROADMAP.md` F9-S05
> **blocks:** —

## Objetivo
Entrega confiável de webhooks ao cliente: capturar eventos de domínio (`message.received`/`message.sent`/`conversation.status_changed`/`conversion.created`/`deal.stage_changed`/...), criar `outbound_webhook_deliveries` para cada `outbound_webhooks` que assina o evento, e despachar HTTP POST **assinado com HMAC** (reusa `channels/shared/hmac.ts` sobre `secret_enc`), com **retry exponencial** (tick drena pendentes/`retrying` por `next_attempt_at`).

## Escopo (faz)
- `apps/workers/src/webhooks/**`: consumer dos eventos de domínio (reusa o stream/queue existente do socket-relay/eventos), match de assinaturas, criação de deliveries, dispatcher (POST + header `X-HM-Signature` HMAC-SHA256 + timestamp), retry exponencial (1s→…→cap; `attempt`/`next_attempt_at`/`status`), e marcação `sent`/`failed`.
- Registro no bootstrap + scheduler (gap-fill orchestrator).

## Fora de escopo
- Schema (F9-S01), CRUD/test-button (F9-S04 dispara via fila), API pública (F9-S03).

## Arquivos permitidos
- `apps/workers/src/webhooks/**`

## Definition of Done
- [ ] Evento de domínio cria deliveries para assinantes corretos; POST assinado com HMAC; falha → retry exponencial até cap, depois `failed`; idempotente (não duplica delivery por evento×webhook).
- [ ] `pnpm --filter @hm/workers test` (http/db mockados) + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- HMAC reusa `packages/channels/src/shared/hmac.ts`. Os eventos de domínio já trafegam (socket-relay F1-S11 / eventos de deal F5-S07 / conversões F5) — consuma deles, não reemita. Timeout por request + DLQ após N falhas.
