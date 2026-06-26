---
id: F51-S04
title: Enriquecer GET executions com flowName + emitir no cancel (apps/api)
phase: F51
status: in-progress
priority: high
estimated_size: S
depends_on: [F51-S01]
blocks: [F51-S05]
agent_id: backend-engineer
source_docs:
  - docs/features/FLOW_BUILDER.md
claimed_at: 2026-06-26T21:38:24Z

---
# F51-S04 — flowName no GET + socket no cancel

## Objetivo

Incluir `flowName` no payload de execuções por conversa e emitir `flow_execution:updated` (cancelled)
em tempo real quando uma execução é cancelada pela API.

## Contexto

A query atual retorna só ids (sem nome do flow). O cancel persiste mas não notifica (e usa o
defaultEngine sem MQ → a engine não emite nesse caminho).

## Escopo (faz)

- `apps/api/src/routes/flows/executions.ts`:
  - GET `/api/flows/executions`: substituir `select()` por select explícito + `leftJoin(schema.flows,
    eq(flows.id, flowExecutions.flowId))` adicionando `flowName: flows.name`. Manter as colunas que o
    front usa (`id, flowId, status, currentNodeId, startedAt, nextStepAt, completedAt, lastError`),
    guard `[requireAuth, withRLS]` e `orderBy(desc(startedAt))`.
  - POST `/cancel`: ampliar a query de existência para trazer `conversationId`/`flowId`; após
    `cancelFlowExecution`, emitir `flow_execution:updated` (status `cancelled`, nextStepAt null) via
    helper espelhando `emitAgentChanged` (`routes/conversations/agent.ts`: getMqHandle + makeEnvelope
    'socket.relay' + sendToQueue). Best-effort (não falha o 204).
- `apps/api/src/routes/flows/executions.test.ts` (novo): GET retorna `flowName` (join).

## Fora de escopo

- Engine/worker (S02/S03). UI (S05/S06).

## Arquivos permitidos

- `apps/api/src/routes/flows/executions.ts`
- `apps/api/src/routes/flows/executions.test.ts`

## Arquivos proibidos

- Demais rotas, `app.ts`, `uuid-params.ts` (sem rota literal nova → sem carve-out).

## Contratos de saída

- GET `/api/flows/executions` item += `flowName: string | null`.

## Definition of Done

- [ ] GET inclui `flowName` (leftJoin; null se flow deletado); guard inalterado.
- [ ] cancel emite `flow_execution:updated` (cancelled) best-effort; 204 mantido.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/api test` verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Manter sem `flow.list` no GET (atendente precisa ver). Join roda sob `req.scoped` (RLS).
