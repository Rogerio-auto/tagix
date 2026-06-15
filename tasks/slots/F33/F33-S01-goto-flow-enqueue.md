---
id: F33-S01
title: go_to_flow — enqueue step do flow filho no dispatcher
phase: F33
status: done
priority: high
estimated_size: S
depends_on: []
blocks: []
source_docs:
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-06-15T21:52:12Z
completed_at: 2026-06-15T21:54:09Z

---
# F33-S01 — go_to_flow enqueue fix

## Objetivo

Fechar o seam do `go_to_flow`: após o handler criar a `flow_execution` do flow filho e gravar `_goto_flow_execution_id` nas variáveis, o dispatcher deve enfileirar o primeiro step dessa execução via `deps.queue.enqueueStep` — fazendo o subflow disparar de verdade.

## Contexto

O handler `go_to_flow.handler.ts` (F31-S11) já faz tudo certo:
1. Valida anti-loop (MAX_DEPTH=5)
2. Cria `flow_execution` do flow alvo via `withWorkspace`
3. Grava `_goto_flow_execution_id` + `_goto_flow_initiated: true` nas variables da execução atual

O que falta é o **dispatcher** (`packages/flow-engine/src/dispatcher.ts`) detectar esses marcadores após o step retornar `DONE` e chamar `deps.queue.enqueueStep({ workspaceId, executionId: newExId })`. O seam foi documentado na linha 21 do handler:
```ts
// SEAM: o worker precisa ler `_goto_flow_execution_id` das variables após completar
// o step e enfileirar o step do flow alvo via `deps.queue.enqueueStep`.
await deps.queue.enqueueStep({ workspaceId: exec.workspaceId, executionId: newExId });
```

## Escopo (faz)

- **`packages/flow-engine/src/dispatcher.ts`** — após `handler.execute(node, ctx)` retornar `{ status: 'DONE' }` (ou `CONTINUE`), verificar nas variables atualizadas se `_goto_flow_initiated === true`. Se sim: ler `_goto_flow_execution_id`, chamar `await deps.queue.enqueueStep({ workspaceId: exec.workspaceId, executionId: String(variables['_goto_flow_execution_id']) })`. Limpar `_goto_flow_initiated` das variables antes de persistir (evitar loop).
- **`packages/flow-engine/src/dispatcher.test.ts`** — adicionar teste: flow A com node `go_to_flow(flowId=B)` → após `processFlowStepScoped`, verificar que `queue.enqueueStep` foi chamado com o executionId correto. Usar `createInMemoryQueuePort()`.
- **`packages/flow-engine/src/handlers/go_to_flow.handler.ts`** — remover comentário de seam `// SEAM: o worker precisa...` (seam fechado).

## Fora de escopo

- Bridge de mensagens (S02)
- UX pickers (S03)
- Mudança no handler além de remover o comentário de seam

## Arquivos permitidos

- `packages/flow-engine/src/dispatcher.ts`
- `packages/flow-engine/src/dispatcher.test.ts`
- `packages/flow-engine/src/handlers/go_to_flow.handler.ts`

## Arquivos proibidos

- `packages/flow-engine/src/types.ts`
- `apps/workers/**`
- `apps/web/**`

## Definition of Done

- [ ] `processFlowStepScoped` em flow A com node `go_to_flow` chama `queue.enqueueStep` com o `executionId` do flow B.
- [ ] `_goto_flow_initiated` removido das variables persistidas (não volta a disparar em re-entrega idempotente).
- [ ] Comentário de seam removido do handler.
- [ ] Teste unitário cobre: (a) go_to_flow válido → enqueue; (b) go_to_flow sem `flowId` configurado → sem enqueue (no-op já existente).
- [ ] `pnpm typecheck` + `pnpm --filter @hm/flow-engine test` verdes.

## Validação

```bash
pnpm typecheck
pnpm --filter @hm/flow-engine test
```

## Notas

A variável `_goto_flow_initiated` é um marcador temporário — deve ser limpada (deletada do objeto de variables) antes de `persistVariables(tx, exec.executionId, updatedVariables)` para que uma re-entrega RabbitMQ do mesmo envelope não enfileire um segundo step do flow filho (idempotência).

O guard anti-loop (MAX_DEPTH=5) já está no handler — não reimplementar no dispatcher.
