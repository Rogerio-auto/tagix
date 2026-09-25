---
id: F70-S16
title: Outbox transacional para eventos de domínio e jobs, com dedup indexado dos webhooks
phase: F70
status: available
priority: high
estimated_size: L
depends_on: [F70-S14, F70-S12]
blocks: [F70-S17]
source_docs:
  - tasks/slots/F70/F70-S09-ligar-os-webhooks-de-saida.md
  - tasks/slots/F70/F70-S14-eventos-completos-de-lead-ads-e-campanha.md
---
# F70-S16 — Outbox transacional para eventos de domínio e jobs, com dedup indexado dos webhooks

## Objetivo

Nenhum evento de domínio nem job de outbound se perder, ou sair de uma transação que não aconteceu. Hoje a publicação vem depois do commit: se o processo cair entre os dois, o aviso some, e a delivery de campanha fica `queued` sem job.

## Escopo

### files_allowed

- `packages/db/drizzle/**` *(migração 0086)*
- `packages/db/src/schema/outbox.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/schema/webhooks.ts`
- `packages/db/src/outbox*.ts`
- `packages/db/src/index.ts`
- `packages/shared/src/mq/**`
- `apps/workers/src/outbox/**`
- `apps/workers/src/bootstrap/index.ts`
- `apps/workers/src/webhooks/**`
- `apps/workers/src/leadgen/**`
- `apps/workers/src/campaigns/**`
- `apps/workers/src/coexistence/**`
- `apps/workers/src/inbound/db-ports.ts`
- `apps/workers/src/outbound/finalize.ts`

## Escopo (faz)

- Tabela `outbox` (migração 0086): evento ou job, routing, payload, `event_id` único, estado, tentativas, `available_at`. Sem RLS de tenant (é infraestrutura do sistema): acesso só pelo papel dos workers, com GRANT explícito e documentado.
- `enqueueOutbox(tx, message)` em `@hm/db`: grava na mesma transação do dado.
- Relay em `apps/workers/src/outbox`:
  - lê com `FOR UPDATE SKIP LOCKED` dentro de transação e publica com publisher confirms;
  - marca como enviado, com backoff e tentativas máximas;
  - publica pelo menos uma vez, com dedup no consumidor pelo `event_id`;
  - acorda por `LISTEN/NOTIFY` ou por polling curto;
  - limpa o que já foi enviado.
- Produtores dos workers migrados para o outbox: leadgen, campaigns (incluindo o job de outbound; a compensação da S14 deixa de ser necessária), coexistence, inbound, outbound/finalize.
- Índice único `(webhook_id, (payload #>> '{_meta,eventId}'))` em `outbound_webhook_deliveries`; o fan-out usa `ON CONFLICT DO NOTHING` no lugar da varredura com advisory lock.

## Fora de escopo

- Produtores da API (F70-S17, depois da F70-S11).

## Definition of Done

- [ ] teste: rollback → nada no outbox e nada publicado
- [ ] teste: processo "cai" depois do commit (relay parado) → ao voltar, o evento é publicado
- [ ] teste: broker fora → tentativas com backoff, depois entrega
- [ ] teste: dois relays em paralelo → cada mensagem publicada uma vez em condições normais
- [ ] teste: fan-out dedup pelo índice
