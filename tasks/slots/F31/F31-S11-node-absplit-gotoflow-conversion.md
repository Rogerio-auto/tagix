---
id: F31-S11
title: Nodes ab_split + go_to_flow + UI de register_conversion
phase: F31
status: in-progress
priority: medium
estimated_size: M
depends_on: [F31-S08]
blocks: []
source_docs:
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-06-15T19:56:32Z

---
# F31-S11 — Nodes ab_split + go_to_flow + register_conversion (UI)

## Objetivo

Três nodes de controle/conversão: `ab_split` (ramificação por peso), `go_to_flow` (subflow/encadeamento) e a **UI de `register_conversion`** (handler já existe desde a F5; faltava o node na tela).

## Contexto

Nenhum envia mensagem → não dependem do bridge. `register_conversion` é o 16º handler (`registry.ts`) que nunca teve node na UI. Stubs criados em S08.

## Escopo (faz)

- `packages/flow-engine/src/handlers/ab_split.handler.ts` — ramifica por peso (edges dinâmicos por variante).
- `packages/flow-engine/src/handlers/go_to_flow.handler.ts` — transfere a execução para outro flow (guard anti-loop).
- `apps/web/features/flow-builder/nodes/ab_split/**` + `nodes/go_to_flow/**` + `nodes/register_conversion/**` — inspectors reais (peso por variante; seletor de flow; tipo de conversão + valor via S03).

## Fora de escopo

- Espinha/registry (S08). Handler de register_conversion (já existe — só a UI).

## Arquivos permitidos

- `packages/flow-engine/src/handlers/ab_split.handler.ts`
- `packages/flow-engine/src/handlers/go_to_flow.handler.ts`
- `apps/web/features/flow-builder/nodes/ab_split/**`
- `apps/web/features/flow-builder/nodes/go_to_flow/**`
- `apps/web/features/flow-builder/nodes/register_conversion/**`

## Arquivos proibidos

- `registry.ts`, `validation.ts`, `node-catalog.ts`, `nodeTypes.ts`, `nodeInspectors.ts`, `handlers/register_conversion.handler.ts`.

## Definition of Done

- [ ] ab_split distribui execuções por peso configurável.
- [ ] go_to_flow encadeia flows com proteção contra loop.
- [ ] register_conversion configurável pela UI e registra conversão.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## UX considerations

- `UX_PRINCIPLES`: pesos com soma visível (100%); seletor de flow por picker; tipo de conversão por picker (S03).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
pnpm --filter @hm/web test
```

## Notas

- go_to_flow precisa de guard de profundidade/loop (flows encadeados). Relacionado: [[tagix-flow-builder-v2-survey]], [[tagix-f5-decomposition]].
