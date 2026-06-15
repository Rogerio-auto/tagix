---
id: F31-S08
title: Scaffold dos novos nodes + limpeza do catálogo (espinha)
phase: F31
status: in-progress
priority: high
estimated_size: M
depends_on: [F31-S03]
blocks: [F31-S09, F31-S10, F31-S11]
source_docs:
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-06-15T13:04:09Z

---
# F31-S08 — Scaffold dos novos nodes + limpeza do catálogo

## Objetivo

Registrar a **espinha** dos novos node types (registry + catálogo + maps de UI) com handlers/components **stub**, mantendo typecheck verde, para os slots de fill preencherem em paralelo. Também limpa o catálogo stale.

## Contexto

Padrão scaffold-then-fill (igual F4-S02): este slot é DONO dos arquivos-espinha; os slots S09/S10/S11 preenchem APENAS o handler + o dir do seu node. Novos tipos: `set_variable`, `input`, `assign`, `template`, `ab_split`, `go_to_flow`, e o node UI de `register_conversion` (handler já existe). Nodes são jsonb → sem migration.

## Escopo (faz)

- `packages/flow-engine/src/registry.ts` — adicionar os novos tipos (imports dos handlers stub).
- `packages/flow-engine/src/validation.ts` — registrar os novos tipos na validação de flow.
- `packages/flow-engine/src/handlers/{set_variable,input,assign,template,ab_split,go_to_flow}.handler.ts` — **stubs** (schema mínimo + execute no-op tipado).
- `apps/web/features/flow-builder/shared/node-catalog.ts` — adicionar os novos nodes + **`register_conversion` (16º)**; **remover flags `deferred` stale** de add_tag/remove_tag/move_stage.
- `apps/web/features/flow-builder/nodes/nodeTypes.ts` + `nodeInspectors.ts` — mapear os novos kinds (+register_conversion).
- `apps/web/features/flow-builder/nodes/{set_variable,input,assign,template,ab_split,go_to_flow,register_conversion}/**` — **stubs** (Node + Inspector mínimos).

## Fora de escopo

- Lógica real dos novos nodes (S09/S10/S11). Inspectors dos nodes existentes (Onda 2).

## Arquivos permitidos

- `packages/flow-engine/src/registry.ts`
- `packages/flow-engine/src/validation.ts`
- `packages/flow-engine/src/handlers/{set_variable,input,assign,template,ab_split,go_to_flow}.handler.ts`
- `apps/web/features/flow-builder/shared/node-catalog.ts`
- `apps/web/features/flow-builder/nodes/nodeTypes.ts`
- `apps/web/features/flow-builder/nodes/nodeInspectors.ts`
- `apps/web/features/flow-builder/nodes/{set_variable,input,assign,template,ab_split,go_to_flow,register_conversion}/**`

## Arquivos proibidos

- `handlers/message.handler.ts` e handlers de nodes existentes; `helpers-context.tsx`; `VariablesPicker.tsx`.

## Definition of Done

- [ ] Novos kinds aparecem no palette/catálogo; register_conversion vira o 16º node.
- [ ] Flags `deferred` removidas de add_tag/remove_tag/move_stage.
- [ ] Stubs mantêm `pnpm typecheck` verde nos 13 projetos.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## Notas

- DELIBERADO: S09/S10/S11 vão sobrescrever os stubs dos seus nodes; por isso dependem deste slot (nunca rodam em paralelo com ele). Disjuntos ENTRE SI (dirs/handlers diferentes).
- Catálogo é a fonte única de label/icon/edges (`node-catalog.ts`). Relacionado: [[tagix-flow-builder-v2-survey]].
