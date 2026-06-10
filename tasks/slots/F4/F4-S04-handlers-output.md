---
id: F4-S04
title: Handlers de saída — trigger + message + interactive + meta_flow
phase: F4
status: review
priority: high
estimated_size: M
depends_on: [F4-S02]
agent_id: backend-engineer
claimed_at: 2026-06-10T20:22:34Z
completed_at: 2026-06-10T20:24:02Z

---
# F4-S04 — Handlers de saída

> **source_docs:** `docs/features/FLOW_BUILDER.md` §3.4, §4.1; `docs/ROADMAP.md` F4-S05
> **blocks:** —

## Objetivo
Implementar (substituindo os stubs de F4-S02) os handlers que produzem saída: `trigger` (nó inicial, no-op SUCCESS), `message` (texto/mídia/áudio/voz + pre_action + interpolação), `interactive` (buttons/list) e `meta_flow` (dispara WhatsApp Flow). Todos publicam outbound via o `FlowExecutionContext` (não tocam infra direto).

## Escopo (faz)
- `handlers/trigger.handler.ts`, `handlers/message.handler.ts`, `handlers/interactive.handler.ts`, `handlers/meta_flow.handler.ts`: cada um com seu Zod `schema` + `execute` conforme §3.4; `message` aplica `interpolate` no texto e respeita `preAction`/`audioMessageKind` (§3.5 exemplo).

## Fora de escopo
- Engine/registry/context (F4-S02, dono), handlers de lógica/sistema/externos (F4-S05/06).

## Arquivos permitidos
- `packages/flow-engine/src/handlers/trigger.handler.ts`
- `packages/flow-engine/src/handlers/message.handler.ts`
- `packages/flow-engine/src/handlers/interactive.handler.ts`
- `packages/flow-engine/src/handlers/meta_flow.handler.ts`

## Arquivos proibidos
- `packages/flow-engine/src/registry.ts`, `index.ts`, `types.ts`, `context.ts`, `dispatcher.ts` (donos: F4-S02)

## Definition of Done
- [ ] Os 4 handlers implementam `FlowHandler<T>`; `message`/`interactive`/`meta_flow` publicam outbound pelo ctx; `message` interpola variáveis.
- [ ] Testes unitários por handler (ctx/outbound mockados), incl. erro de schema → `ERROR`.
- [ ] `pnpm --filter @hm/flow-engine test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Roda em paralelo com F4-S05/S06 (arquivos de handler disjuntos). Não toque a registry.
