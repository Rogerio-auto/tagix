---
id: F32-S01
title: Delete node — teclado + botão + guard trigger
phase: F32
status: available
priority: high
estimated_size: S
depends_on: []
blocks: []
source_docs:
  - docs/features/FLOW_BUILDER.md

---
# F32-S01 — Delete node UI

## Objetivo

Permitir ao usuário excluir qualquer node do canvas via teclado (`Delete`/`Backspace`) e via botão trash no header do InspectorPanel, com guard que impede a deleção do node `trigger` (único por flow).

## Contexto

ReactFlow + `useFlowEditor` já suportam deleção via `applyNodeChanges` com type `"remove"` — o plumbing está pronto. O que falta é 100% UX: não há tecla, botão ou menu de contexto para acionar a remoção. Usuário hoje precisa recriar o flow do zero se errar.

## Escopo (faz)

- **`FlowCanvas.tsx`** — habilitar `deleteKeyCode={['Delete', 'Backspace']}` no `<ReactFlow>` (prop nativa); garantir que `onNodesDelete` propaga para o store (`useFlowEditor.deleteNodes`) para persistência.
- **`useFlowEditor.ts`** — adicionar action `deleteNodes(ids: string[])` se ainda não existir; chama `applyNodeChanges` com `{ type: 'remove', id }` por node; guard: filtrar ids de node com `type === 'trigger'` (trigger não pode ser deletado).
- **`InspectorPanel.tsx`** — adicionar ícone trash (`Trash2` de lucide) no header do panel, ao lado do label do tipo; desabilitado (com tooltip "Gatilho não pode ser excluído") quando o node selecionado é o trigger; clique chama `deleteNodes([nodeId])`.
- Ao deletar um node, ReactFlow remove automaticamente as edges conectadas — garantir que a store não fique com edges orfãs (testar).

## Fora de escopo

- Menu de contexto (right-click) — pode ser future slot
- Confirm dialog — delete direto (padrão Linear/Figma)
- Duplicate node — future slot
- Undo/Redo — já existe? se não, future slot

## Arquivos permitidos

- `apps/web/features/flow-builder/canvas/FlowCanvas.tsx`
- `apps/web/features/flow-builder/hooks/useFlowEditor.ts`
- `apps/web/features/flow-builder/inspector/InspectorPanel.tsx`

## Arquivos proibidos

- `apps/web/features/flow-builder/nodes/**` (pertence aos slots S02-S05)
- `packages/flow-engine/**`

## Definition of Done

- [ ] `Delete`/`Backspace` remove node selecionado (não trigger) e suas edges.
- [ ] Botão trash no InspectorPanel remove o node aberto (não trigger).
- [ ] Clicar no botão para node trigger mostra tooltip e não faz nada.
- [ ] Nenhuma edge orfã fica na store após deleção.
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## UX considerations

- Linear e Figma deletam sem confirm — não add confirm dialog (velocidade > segurança no canvas).
- Trash icon: `Trash2` (lucide), tamanho 14px, cor `text-muted-foreground hover:text-destructive`, no header do InspectorPanel ao lado do título.
- Tooltip no trigger: `"O gatilho não pode ser excluído"` (DS v2 Tooltip).
- Node selecionado fica visualmente destacado — Delete/Backspace só age quando focus está no canvas (não num input text).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

ReactFlow prop `deleteKeyCode` aceita `string | string[] | null`. Para desabilitar delete por teclado no trigger especificamente, interceptar via `onBeforeDelete` callback (ReactFlow ≥ 11) ou filtrar no `onNodesDelete`. Verificar versão do ReactFlow usada no projeto (`apps/web/package.json`).
