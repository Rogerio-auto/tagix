---
id: F51-S03
title: Publisher real do FlowEventsPort → socket relay (apps/workers)
phase: F51
status: blocked
priority: high
estimated_size: S
depends_on: [F51-S01, F51-S02]
blocks: []
agent_id: backend-engineer
source_docs:
  - docs/features/FLOW_BUILDER.md
---

# F51-S03 — Publisher de eventos de execução (worker)

## Objetivo

Implementar a impl real do `FlowEventsPort` que publica `flow_execution:updated` em `hm.q.socket.relay`,
e injetá-la na engine do worker de flows.

## Contexto

A engine (S02) chama `deps.events?.executionChanged`. No worker, isso vira um envelope socket.relay,
espelhando `emitMessageNewRelay` do `outbound-publisher.ts`.

## Escopo (faz)

- `apps/workers/src/flows/execution-events-publisher.ts` (novo): `createFlowEventsPublisher({ logger,
  publish? }): FlowEventsPort`. `executionChanged(e)` monta `makeEnvelope('socket.relay', e.workspaceId,
  { event: 'flow_execution:updated', target: { conversationId: e.conversationId ?? undefined,
  workspace: true }, data: { conversationId, flowId, executionId, status, nextStepAt: e.nextStepAt?
  e.nextStepAt.toISOString() : null } })` → `sendToQueue('hm.q.socket.relay', …, { persistent:true,
  contentType:'application/json' })`. `publish` injetável (default real, canal lazy igual outbound).
  Best-effort: try/catch + `logger.warn` (nunca propaga).
- `apps/workers/src/flows/worker.ts` `createFlowWorkerDeps`: passar `events: createFlowEventsPublisher({
  logger })` ao `createFlowEngine`.
- `apps/workers/src/flows/execution-events-publisher.test.ts` (novo): `publish` fake → asserta event,
  target, status e `nextStepAt` ISO (e null).

## Fora de escopo

- Emissão na API (S04). UI (S05/S06).

## Arquivos permitidos

- `apps/workers/src/flows/execution-events-publisher.ts`
- `apps/workers/src/flows/execution-events-publisher.test.ts`
- `apps/workers/src/flows/worker.ts`

## Arquivos proibidos

- `apps/workers/src/flows/outbound-publisher.ts` (sem mudança), demais.

## Definition of Done

- [ ] `createFlowEventsPublisher` publica `flow_execution:updated` no relay com payload correto.
- [ ] worker injeta `events` na engine.
- [ ] Best-effort: erro de publish não propaga.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/workers test` verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas

- Reusar `getHandle`/`makeEnvelope`/`SOCKET_RELAY_QUEUE` (padrão de `outbound-publisher.ts`).
