---
id: F56-S17
title: Workers ops — healthcheck + graceful drain + DLQ alert + lock watchdog
phase: F56
status: blocked
priority: high
estimated_size: M
depends_on: [F56-S25]
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
---

# F56-S17 — Robustez operacional dos workers (INF-07/08/10)

> **Origem:** AUDITORIA_TECNICA.md §3.2. Workers sem healthcheck (consumer travado indetectável); DLQ sem consumidor/alerta; shutdown não drena in-flight; locks de scheduler sem renovação (dois ticks concorrentes).

## Objetivo

Dar aos workers detecção de saúde, encerramento gracioso, alerta de DLQ e locks de scheduler que não expiram no meio do tick.

## Contexto / causa raiz (verificada)

- **INF-07:** só `/metrics`; sem `/healthz` refletindo consumers/conexão.
- **INF-08:** `dlq/index.ts:37-50` só CLI; sem métrica de profundidade/alerta.
- **INF-10:** `bootstrap/index.ts:406-437` fecha canal sem `channel.cancel`/drain; `flows/scheduler.ts:64-78` sem renovação de lock.

## Escopo (faz)

- `/healthz` (liveness+readiness) checando conexão AMQP (interface exposta por F56-S12) + último tick dos schedulers.
- Graceful shutdown: `channel.cancel` + aguardar in-flight com deadline antes de fechar.
- Métrica `hm_dlq_depth` + alerta (log estruturado/Sentry) por mensagem morta.
- Watchdog de renovação nos locks de scheduler (ex. `flows/scheduler.ts`).
- Wiring do `startCampaignRecompute` (F56-S02) e do retention worker (F56-S25) no `bootstrap`/`main.ts`.

## Escopo (não faz)

- Reconnect AMQP em si (F56-S12). Buffer de IA (F56-S15, self-start). Prometheus stack (F56-S18).

## Arquivos permitidos

- `apps/workers/src/bootstrap/**`
- `apps/workers/src/main.ts`
- `apps/workers/src/dlq/**`
- `apps/workers/src/observability/**`
- `apps/workers/src/flows/scheduler.ts`

## Arquivos proibidos

- `apps/workers/src/agents/**` (F56-S15) · `apps/workers/src/campaigns/**` (F56-S02/S03) · `apps/workers/src/retention/**` (F56-S25)

## Definition of Done

- [ ] `/healthz` retorna unhealthy quando a conexão AMQP cai.
- [ ] Shutdown drena mensagens in-flight (sem redelivery desnecessária).
- [ ] DLQ com métrica de profundidade + alerta.
- [ ] Lock de scheduler renova durante tick longo (sem dois ticks).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/workers test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

- **Depende de F56-S25** (retention) para wirar seu start no bootstrap; a interface de saúde da conexão vem de F56-S12 — combinar via COMMS. Este é o único slot que edita `bootstrap/**` e `main.ts` (evita colisão de hotspot).
