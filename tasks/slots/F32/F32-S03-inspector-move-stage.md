---
id: F32-S03
title: Inspector move_stage com PipelinePicker + StagePicker
phase: F32
status: review
priority: high
estimated_size: S
depends_on: []
blocks: []
source_docs:
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-06-15T21:30:33Z
completed_at: 2026-06-15T21:31:09Z

---
# F32-S03 — Inspector move_stage

## Objetivo

Substituir o `DeferredNotice` placeholder de `move_stage` por PipelinePicker + StagePicker filtrado pela pipeline selecionada — o handler `move_stage.handler.ts` está funcional desde a F5.

## Contexto

O inspector renderiza apenas `DeferredNotice()`. O handler exige `stageId: uuid` + `pipelineId: uuid`. A seleção de stage sem contexto de pipeline seria uma lista enorme e confusa — o fluxo correto é: (1) escolha a pipeline, (2) escolha a etapa dentro dessa pipeline.

## Escopo (faz)

- **`MoveStageInspector.tsx`** — remover DeferredNotice; duas selects em cascata:
  1. **PipelinePicker** — consome `useFlowHelpers().pipelines`; salva `pipelineId` no node data.
  2. **StagePicker** — filtra stages pelo `pipelineId` selecionado; salva `stageId`; desabilitado até pipeline ser escolhida.
- Ao mudar a pipeline, limpar `stageId` (evitar stage de outra pipeline).
- Remover import de `DeferredNotice`.

## Fora de escopo

- Criação de pipelines/stages (redireciona para settings)
- `add_tag`/`remove_tag` (S02 separado)

## Arquivos permitidos

- `apps/web/features/flow-builder/nodes/move_stage/**`

## Arquivos proibidos

- `helpers-context.tsx`, `nodeInspectors.ts`, `node-catalog.ts`

## Definition of Done

- [ ] Inspector renderiza PipelinePicker; ao selecionar pipeline, StagePicker lista apenas stages dessa pipeline.
- [ ] `stageId` e `pipelineId` salvos corretamente no node data.
- [ ] Mudar pipeline limpa a stage selecionada.
- [ ] DeferredNotice removido.
- [ ] Estado vazio (sem pipelines) exibe hint.
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## UX considerations

- StagePicker desabilitado (com placeholder "Selecione uma pipeline primeiro") até pipeline ser escolhida.
- Não usar campo de texto livre para IDs (anti-pattern gear-only entry).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

Verificar se `helpers-context` expõe `pipelines` com as stages aninhadas (ex: `{ id, name, stages: { id, name }[] }`). Se `stages` não vier aninhado, pode ser necessário uma chamada separada de `/api/pipelines/:id/stages` — documentar o seam se for o caso.
