---
id: F56-S12
title: MQ resilience — reconnect AMQP + reliableQueues + backpressure
phase: F56
status: available
priority: critical
estimated_size: M
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
---

# F56-S12 — Confiabilidade da malha AMQP (INF-01/INF-03/INF-12, DB-07)

> **Origem:** AUDITORIA_TECNICA.md §3.2. Sem reconnect AMQP (um blip reinicia a frota ou trava um consumer sem alarme); só inbound/outbound/media têm retry+DLQ (flows/campaigns/coexistence fazem nack-drop silencioso); enqueues internos ignoram backpressure.

## Objetivo

Tornar a camada de mensageria resiliente a blips de RabbitMQ e garantir at-least-once em todas as filas de trabalho, não só no canal de mensagem.

## Contexto / causa raiz (verificada)

- **INF-01:** `packages/shared/src/mq/connection.ts:10-15` — sem `on('error')`/`on('close')`/reconnect.
- **INF-03/DB-07:** `packages/shared/src/mq/retry.ts:89-95` — `reliableQueues()` = só `[inbound, outbound, media]`; demais filas fazem `nack(msg,false,false)` (descarte) em erro.
- **INF-12:** `sendToQueue/publish` internos não checam retorno `false` (buffer cheio).

## Escopo (faz)

- Wrapper de conexão com auto-reconnect + backoff: re-declara topologia, re-cria canais e re-registra consumers no `close`/`error`; expõe estado para healthcheck.
- Estender `reliableQueues()` para incluir `flows`, `flow.execution`, `campaigns`, `coexistence`, `kb_ingest` (a topologia de retry já existe).
- Helper de publish que respeita backpressure (aguarda `drain`) ou publisher confirms; ao menos contabilizar `false`.

## Escopo (não faz)

- Claim atômico do flow-engine (F56-S13 — `packages/flow-engine`). Relay de socket (F56-S16 — `apps/api/src/socket/relay.ts`). Healthcheck do processo worker (F56-S17 — `bootstrap`).

## Arquivos permitidos

- `packages/shared/src/mq/**`

## Arquivos proibidos

- `packages/shared/src/mq/dlx.test.ts` só se colidir com outro slot — este slot é dono do dir `mq/`.

## Definition of Done

- [ ] Matar e reiniciar o RabbitMQ re-registra os consumers sem restart do processo (teste/mode simulado).
- [ ] Erro num handler de `flows`/`campaigns`/`coexistence` vai para a ladder de retry/DLQ, não nack-drop.
- [ ] Publish respeita backpressure (não perde job com buffer cheio).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/shared test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/shared test
```

## Notas

- Considerar `amqp-connection-manager` para o wrapper; manter a interface `connectMq` atual para não quebrar os consumers.
- O estado de conexão exposto aqui alimenta o `/healthz` dos workers (F56-S17) — combinar a interface via COMMS.
