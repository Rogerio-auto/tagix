---
id: F51-S02
title: FlowEventsPort + emissão de estado no dispatcher (@hm/flow-engine)
phase: F51
status: review
priority: high
estimated_size: M
depends_on: []
blocks: [F51-S03]
agent_id: backend-engineer
source_docs:
  - docs/features/FLOW_BUILDER.md
claimed_at: 2026-06-26T21:31:30Z
completed_at: 2026-06-26T21:35:56Z

---
# F51-S02 — FlowEventsPort + emissão no dispatcher

## Objetivo

Adicionar uma porta de eventos opcional à engine e emitir notificações de mudança de estado da
execução (running/waiting/completed/failed/cancelled) nos pontos certos do dispatcher, sem quebrar a
pureza nem os fakes de teste.

## Contexto

O dispatcher faz `patchExecution` em cada transição mas não notifica ninguém. A impl real do port é
wireada pelo worker (S03); o defaultEngine fica sem port (no-op). Best-effort: falha de socket nunca
aborta um step.

## Escopo (faz)

- `deps.ts`: `FlowExecutionEvent { workspaceId, executionId, flowId, conversationId: string|null,
  status: LoadedExecution['status'], nextStepAt: Date|null }` + `FlowEventsPort { executionChanged(e):
  Promise<void>|void }`. `FlowEngineDeps.events?: FlowEventsPort` (OPCIONAL).
- `dispatcher.ts`: helper `emit(deps, e)` em try/catch (engole erro). Emitir SOMENTE:
  - `triggerFlow` (após createExecution) → `running`, nextStepAt null.
  - `runStep` ramo WAITING (após patch) → `waiting`, nextStepAt = new Date(result.nextStepAt).
  - `runStep` ramo sem-node (completa) → `completed`.
  - `advance` ramo SEM target (completa) → `completed`. (ramo COM target = running→running: **NÃO** emitir.)
  - `persistFailure` (após patch) → `failed`.
  - `cancelFlowExecution` (após patch) → `cancelled`.
  - `resumeFlowWithResponse` (waiting→running) → `running`.
- `index.ts`: `createFlowEngine` repassa `events: overrides.events`.
- `dispatcher.test.ts`: cobrir emissões + 0 chamadas em running→running e em cancel de execução já
  terminal + `events` undefined não lança.

## Fora de escopo

- Impl real do publisher (S03). Emissão na rota de cancel da API (S04).

## Arquivos permitidos

- `packages/flow-engine/src/deps.ts`
- `packages/flow-engine/src/dispatcher.ts`
- `packages/flow-engine/src/index.ts`
- `packages/flow-engine/src/dispatcher.test.ts`

## Arquivos proibidos

- `apps/**`, `packages/shared/**`, demais handlers.

## Contratos de saída

- `FlowEventsPort`, `FlowExecutionEvent` exportados de `@hm/flow-engine`.

## Definition of Done

- [ ] `events?` opcional; dispatcher emite no estado certo; running→running NÃO emite.
- [ ] cancel de execução já terminal não emite (respeita o guard existente).
- [ ] engine sem `events` não lança.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/flow-engine test` verdes.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
```

## Notas

- Best-effort é inegociável: socket nunca pode abortar um step de flow.
