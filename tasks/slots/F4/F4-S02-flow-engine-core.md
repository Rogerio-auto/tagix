---
id: F4-S02
title: "@hm/flow-engine core — types + registry + dispatcher + interpolate + stubs de handlers"
phase: F4
status: review
priority: critical
estimated_size: L
depends_on: [F4-S01]
agent_id: backend-engineer
claimed_at: 2026-06-10T20:03:02Z
completed_at: 2026-06-10T20:21:17Z

---
# F4-S02 — @hm/flow-engine core

> **source_docs:** `docs/features/FLOW_BUILDER.md` §3, §6, §8; `docs/ROADMAP.md` F4-S02
> **blocks:** F4-S03, F4-S04, F4-S05, F4-S06, F4-S07, F4-S08, F4-S13, F4-S14

## Objetivo
Núcleo da engine determinística de flows: tipos (`FlowNode`/`FlowEdge`/`FlowHandler`/`FlowHandlerResult`/`FlowExecutionContext`/`FlowNodeType`), `registry` wireando os 15 handlers, `dispatcher` (`triggerFlow`/`processFlowStep`/`resumeFlowWithResponse`/`cancelFlowExecution`/`cancelAllForConversation`), `interpolate` e a API pública `index.ts`. **Scaffolда tudo para compilar:** cria stubs no-op de TODOS os handlers e de `validation.ts` — slots F4-S04/05/06/07 substituem.

## Escopo (faz)
- `types.ts`, `context.ts`, `registry.ts` (`handlerRegistry` satisfies Record<FlowNodeType, FlowHandler> — §3.3), `dispatcher.ts` (algoritmo §3.2: load execution+version, guard, find node, dispatch, log, handle SUCCESS/WAITING/ERROR, re-enqueue), `utils/interpolate.ts` (§8), `index.ts` (API pública §3.1).
- **Stubs** de `handlers/*.handler.ts` para os 15 tipos (cada um `return { status: 'SUCCESS' }` + log). Os 3 bloqueados por schema de F5 — `move_stage`, `add_tag`, `remove_tag` — ficam como **stub-guard permanente em F4** (logam "ativado na F5", não falham); impl real entra na F5. Stub de `validation.ts`.
- Fila `hm.q.flow.execution`: envelope Zod em `packages/shared/src/mq/flows.ts` + binding em `topology.ts` (engine é a produtora — re-enqueue de steps).
- `package.json` do pacote (deps: zod, @hm/db, @hm/shared, @hm/channels, @hm/logger).

## Fora de escopo
- Impl real dos handlers (F4-S04/05/06), validação real (F4-S07), worker/scheduler (F4-S03), API/UI.

## Arquivos permitidos
- `packages/flow-engine/**`
- `packages/shared/src/mq/flows.ts`
- `packages/shared/src/mq/topology.ts`
- `packages/shared/src/mq/index.ts`

## Contratos de saída
- `FlowHandler<T>` interface (§3.4) — contrato fixo para F4-S04/05/06.
- `FlowExecutionContext` expõe ports testáveis (sendMessage/outbound, db scoped, vars) para handlers não tocarem infra direto.
- API pública `index.ts` (§3.1) — consumida por API (F4-S08), worker (F4-S03), dispatcher inbound (F4-S13).
- Envelope `hm.q.flow.execution` `{ workspaceId, executionId }`.

## Definition of Done
- [ ] Pacote compila e testa VERDE com todos os handlers stubados (engine shippável sem os handlers reais).
- [ ] `processFlowStep` implementa o algoritmo §3.2 (incl. versão referenciada, WAITING/next_step_at, re-enqueue) com testes unitários (db/mq mockados).
- [ ] `registry` cobre os 15 tipos; `interpolate` passa nos casos de `{{var.path}}`.
- [ ] `pnpm --filter @hm/flow-engine test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Padrão scaffold-then-fill (igual KB): a registry/index são DONOS de S02 e estáveis; os handler slots só preenchem seus arquivos `*.handler.ts`, nunca a registry. Isso permite S04/05/06 rodarem em paralelo após S02.
- Execução referencia `flow_version_id` (não `flow`) — mudanças no flow não afetam execuções em curso (§7).
