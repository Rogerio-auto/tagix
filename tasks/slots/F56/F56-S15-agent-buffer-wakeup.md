---
id: F56-S15
title: Agent buffer — wakeup durável do flush de agregação
phase: F56
status: available
priority: high
estimated_size: S
depends_on: []
blocks: []
agent_id: backend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
---

# F56-S15 — Buffer de IA: wakeup durável (INF-06)

> **Origem:** AUDITORIA_TECNICA.md §3.2. O flush do lote de mensagens da IA é armado por `setTimeout` in-process; um restart do worker durante a janela de agregação perde o timer e a IA nunca responde àquele turno.

## Objetivo

Garantir que o turno agregado da IA seja respondido mesmo após restart do worker, via scanner durável de deadlines.

## Contexto / causa raiz (verificada)

`apps/workers/src/agents/buffer.ts:190-214` — `windowTimers` (Map) local; o deadline vive no Redis (`hm:agg:deadline:*`) mas nada re-arma o flush após restart.

## Escopo (faz)

- Scheduler durável (padrão flow-wakeup, singleton via lock Redis) que escaneia `hm:agg:deadline:*` vencidos e chama `flush(conversationId)`.
- Iniciar o scheduler dentro do start do agents worker (`apps/workers/src/agents/worker.ts`) — sem tocar `main.ts`/`bootstrap`.

## Escopo (não faz)

- Runtime Python (F56-S01/S11). Ops/healthcheck (F56-S17).

## Arquivos permitidos

- `apps/workers/src/agents/buffer.ts`
- `apps/workers/src/agents/buffer-scheduler.ts`
- `apps/workers/src/agents/worker.ts`

## Arquivos proibidos

- `apps/workers/src/agents/run.ts` · `apps/workers/src/agents/metrics.ts` · `apps/workers/src/agents/reengagement.ts`

## Definition of Done

- [ ] Deadline vencido é flushado mesmo sem o timer in-process original (teste com "restart" simulado).
- [ ] Scheduler é singleton entre instâncias (lock Redis).
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/workers test` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

- Self-start dentro de `agents/worker.ts` evita colisão com o `bootstrap`/`main.ts` (F56-S17). Confirme que `worker.ts` já é o entrypoint do consumer de agentes.
