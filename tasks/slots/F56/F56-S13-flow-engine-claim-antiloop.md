---
id: F56-S13
title: Flow-engine — claim atômico + anti-loop (step_count)
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

# F56-S13 — Flow-engine: concorrência e anti-loop (INF-04/INF-05)

> **Origem:** AUDITORIA_TECNICA.md §3.2. Sem claim atômico, dois envelopes do mesmo `executionId` executam em paralelo → mensagem duplicada. Sem contador de steps, flow cíclico floda a fila infinitamente (DoS auto-infligido).

## Objetivo

Garantir execução exatamente-uma-vez por step e conter flows cíclicos com um teto de profundidade.

## Contexto / causa raiz (verificada)

- **INF-04:** `packages/flow-engine/src/ports/db.port.ts:87-131` — `loadExecution` é SELECT puro, `patchExecution` UPDATE incondicional; guard de status é read-then-act não-atômico; `prefetch(8)` + consume concorrente.
- **INF-05:** `dispatcher.ts:263-310` — `advance` enfileira sem contador de steps/`visited`.

## Escopo (faz)

- Claim atômico: `UPDATE flow_executions SET status='processing' WHERE id=$ AND status IN('running','waiting') RETURNING …` (ou `SELECT … FOR UPDATE`); só processa se reivindicou.
- `step_count` incrementado por step com teto (ex. 1000) → `failed` "loop suspeito"; opcional detecção de ciclo na validação de publish.
- Migration `0063_f56_flow_execution_claim.sql` (coluna `step_count` + estado `processing` se necessário).

## Escopo (não faz)

- reliableQueues / reconnect (F56-S12 — `packages/shared/mq`). Wakeup durável do buffer de IA (F56-S15).

## Arquivos permitidos

- `packages/flow-engine/src/**`
- `packages/db/src/schema/flows.ts`
- `packages/db/drizzle/0063_f56_flow_execution_claim.sql`

## Arquivos proibidos

- `packages/db/drizzle/meta/**` (regenerado no integração)
- `apps/workers/src/flows/**` (o worker consome a engine; não editar aqui)

## Definition of Done

- [ ] Dois envelopes concorrentes do mesmo `executionId` produzem UMA execução (teste).
- [ ] Flow cíclico falha em ≤ teto de steps, sem flood.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/flow-engine test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
```

## Notas

- `RedisLockStore` já existe (usado no outbound) — alternativa ao claim SQL para lock por `executionId`.
- `meta/_journal.json` regenerado pelo integrador.
