---
id: F4-S10
title: Frontend FlowEditorPage — canvas ReactFlow + palette + inspector shell + toolbar + executions panel
phase: F4
status: done
priority: high
estimated_size: L
depends_on: [F4-S08, F4-S07]
agent_id: backend-engineer
claimed_at: 2026-06-10T21:02:03Z
completed_at: 2026-06-10T21:10:48Z

---
# F4-S10 — FlowEditorPage (canvas)

> **source_docs:** `docs/features/FLOW_BUILDER.md` §9.1, §9.2, §9.3, §9.5; `docs/UX_PRINCIPLES.md` §2/§3; `docs/ROADMAP.md` F4-S11
> **blocks:** F4-S11

## Objetivo
Infra do editor visual: canvas `@xyflow/react` com DnD do palette, Zustand local store (changes/undo-redo), salvar (PUT) e publicar (com banner de validação via `validateFlow` de F4-S07 client-side), toolbar, `NodePalette`, `InspectorPanel` (container que resolve qual Inspector renderizar), `ExecutionsPanel` (executions ativas), `VariablesPicker`, e o **registro de nodeTypes (scaffold)** + stubs das pastas de node que F4-S11 preenche.

## Escopo (faz)
- `apps/web/app/(app)/flows/[id]/**`: rota do editor (async params Next 15).
- `apps/web/features/flow-builder/canvas/**`, `inspector/**`, `shared/**`, `hooks/**` (useFlow, useFlowEditor, useFlowExecutions), `services.ts` — conforme árvore §9.2.
- `nodeTypes` registry importando `features/flow-builder/nodes/<tipo>/` (cria stubs dos 15 nodes para o canvas compilar; F4-S11 implementa cada um).

## Fora de escopo
- Implementação visual de cada node + inspector (F4-S11), lista (F4-S09), LiveChat (F4-S12).

## Arquivos permitidos
- `apps/web/app/(app)/flows/[id]/**`
- `apps/web/features/flow-builder/canvas/**`
- `apps/web/features/flow-builder/inspector/**`
- `apps/web/features/flow-builder/shared/**`
- `apps/web/features/flow-builder/hooks/**`
- `apps/web/features/flow-builder/nodes/**`
- `apps/web/features/flow-builder/services.ts`

## Definition of Done
- [ ] Canvas renderiza, DnD do palette cria node, edges conectam; save (PUT) e publish (com banner de issues de `validateFlow`) funcionam.
- [ ] `ExecutionsPanel` lista executions; nodeTypes registry cobre os 15 tipos (stubs).
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes.

## UX considerations
- §2 entrada clara no editor (não modal full-screen — anti-padrão v1); inspector lateral, não overlay que cobre o canvas; §2.7 skeleton ao carregar flow.
- §3 feedback de save/publish (dirty state, banner de validação 3-partes com node destacado); zoom/pan acessível; tokens DS v2 (zero hex).

## Permission scope
- Editor exige `flow.edit`; botão publicar exige `flow.publish` (ADMINS).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- Scaffold-then-fill: o `nodeTypes` registry é dono deste slot; F4-S11 só preenche as pastas `nodes/<tipo>/**`. Permite F4-S11 focar UI sem tocar o canvas.
