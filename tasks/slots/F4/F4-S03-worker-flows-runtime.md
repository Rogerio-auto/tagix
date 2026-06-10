---
id: F4-S03
title: Worker-flows runtime — consumer hm.q.flow.execution + scheduler de wakeup (waiting)
phase: F4
status: review
priority: high
estimated_size: M
depends_on: [F4-S02]
agent_id: backend-engineer
claimed_at: 2026-06-10T20:32:47Z
completed_at: 2026-06-10T20:37:05Z

---
# F4-S03 — Worker-flows runtime + scheduler

> **source_docs:** `docs/features/FLOW_BUILDER.md` §3.2, §4.2, §6; `docs/ROADMAP.md` F4-S03, F4-S04
> **blocks:** —

## Objetivo
Lado runtime da engine: (1) worker que consome `hm.q.flow.execution` e chama `processFlowStep(executionId)`, com retry/DLQ; (2) scheduler cron (tick 1min) que busca `flow_executions` com `status='waiting' AND next_step_at <= now()` e re-enfileira o step (timeout de `wait`/`wait_for_response`).

## Escopo (faz)
- `apps/workers/src/flows/**`: consumer da fila → `processFlowStep`; ack/nack→DLX; idempotência (guard de status no engine cobre re-delivery).
- `apps/workers/src/flows/scheduler.ts`: tick 1min (padrão do followup F2-S21) que varre o índice parcial `idx_flow_executions_status_next` e publica `hm.q.flow.execution` para cada execução vencida.
- Registro no bootstrap dos workers (o wiring final em `bootstrap/index.ts` é gap-fill do orchestrator, padrão F3).

## Fora de escopo
- Engine/dispatcher (F4-S02 é dono de `processFlowStep`), handlers (F4-S04/05/06), trigger dispatch inbound (F4-S13).

## Arquivos permitidos
- `apps/workers/src/flows/**`

## Arquivos proibidos
- `packages/shared/src/mq/topology.ts` (dono: F4-S02 — importar nome da fila read-only)

## Definition of Done
- [ ] Consumir mensagem → `processFlowStep` chamado; falha transitória vai a DLX sem travar a fila.
- [ ] Scheduler re-enfileira execuções `waiting` vencidas (teste com clock/db mockado); não re-enfileira as não-vencidas.
- [ ] `pnpm --filter @hm/workers test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- O scheduler só re-enfileira (não processa) — todo o trabalho roda no consumer, mantendo um único caminho de execução. Backlog alerta > 500 (§11).
