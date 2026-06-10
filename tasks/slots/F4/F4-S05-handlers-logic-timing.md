---
id: F4-S05
title: Handlers de lógica/timing — wait + wait_for_response (biestável) + condition + switch
phase: F4
status: review
priority: high
estimated_size: M
depends_on: [F4-S02]
agent_id: backend-engineer
claimed_at: 2026-06-10T20:24:15Z
completed_at: 2026-06-10T20:26:27Z

---
# F4-S05 — Handlers de lógica e timing

> **source_docs:** `docs/features/FLOW_BUILDER.md` §4.1, §4.2 (biestável), §3.4; `docs/ROADMAP.md` F4-S06
> **blocks:** —

## Objetivo
Implementar (substituindo stubs de F4-S02): `wait` (espera N min → WAITING + next_step_at), `wait_for_response` (biestável: envia opcional + aguarda; edges `response`/`timeout`), `condition` (binário: HAS_TAG/IN_STAGE/BUSINESS_HOURS/HAS_VALUE/MSG_CONTAINS/MSG_EQUALS → edges `true`/`false`), `switch` (multi-branch por variável → dynamic edges).

## Escopo (faz)
- `handlers/wait.handler.ts`, `handlers/wait_for_response.handler.ts`, `handlers/condition.handler.ts`, `handlers/switch.handler.ts`.
- `wait_for_response` implementa a máquina biestável do §4.2 (markers `waiting_for_response`/`responded`/`response_edge`; limpa ao resumir). A retomada por mensagem inbound é wireada em F4-S13 (chama `resumeFlowWithResponse` de F4-S02).
- `condition` HAS_TAG/IN_STAGE: como `contact_tags`/`stages` são F5, esses dois operandos retornam `false` + log "operando disponível na F5" (os demais operandos funcionam normalmente).

## Fora de escopo
- `resumeFlowWithResponse` (F4-S02) e o gatilho inbound de retomada (F4-S13); outros handlers (F4-S04/06).

## Arquivos permitidos
- `packages/flow-engine/src/handlers/wait.handler.ts`
- `packages/flow-engine/src/handlers/wait_for_response.handler.ts`
- `packages/flow-engine/src/handlers/condition.handler.ts`
- `packages/flow-engine/src/handlers/switch.handler.ts`

## Arquivos proibidos
- `packages/flow-engine/src/registry.ts`, `index.ts`, `types.ts`, `context.ts`, `dispatcher.ts` (donos: F4-S02)

## Definition of Done
- [ ] `wait` retorna WAITING com `nextStepAt` correto; `wait_for_response` cobre 1ª chamada / resumption / timeout (§4.2) em teste.
- [ ] `condition` avalia os operandos com schema hoje (MSG_*, BUSINESS_HOURS, HAS_VALUE) e degrada HAS_TAG/IN_STAGE para `false`+log até F5.
- [ ] `switch` roteia por dynamic edge handle; default quando nenhum casa.
- [ ] `pnpm --filter @hm/flow-engine test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Paralelo a F4-S04/S06 (handlers disjuntos).
