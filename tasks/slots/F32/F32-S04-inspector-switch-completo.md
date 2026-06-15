---
id: F32-S04
title: Inspector switch completo — case management + edges dinâmicas
phase: F32
status: review
priority: medium
estimated_size: M
depends_on: []
blocks: []
source_docs:
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-06-15T21:31:38Z
completed_at: 2026-06-15T21:32:48Z

---
# F32-S04 — Inspector switch completo

## Objetivo

Substituir o anti-pattern "casos separados por vírgula" do `SwitchInspector` por uma UI de case management real: lista editável de cases com add/remove, VariablesPicker para a variável, toggle case-sensitive, e edges dinâmicas no node (uma por case + `default`).

## Contexto

O `SwitchInspector` atual usa `TextField` com "Casos (virgula)" — texto livre separado por vírgula. Este é exatamente o anti-pattern "id em texto cru" descrito em `UX_PRINCIPLES`. O handler `switch.handler.ts` rota por `cases: string[]` + `caseSensitive: boolean` — o backend está correto; só a UI está degradada. Além disso, o `SwitchNode.tsx` precisa renderizar as edges dinamicamente conforme os cases mudam (igual ao padrão do `ab_split`).

## Escopo (faz)

- **`SwitchInspector.tsx`** — remover `TextField` de "Casos (virgula)"; implementar:
  1. **VariablesPicker** para campo `variable` (ex: `{{contact.plan}}`).
  2. **Lista de cases** — cada case é um item com input de texto e botão de remover; botão "+ Adicionar caso" no final; mínimo 1 case.
  3. **Toggle case-sensitive** (boolean).
  4. Preview das edges que serão criadas: `[case1, case2, ..., default]`.
- **`SwitchNode.tsx`** — gerar handles de saída dinamicamente a partir de `node.data.cases` (igual à lógica do `AbSplitNode` que usa `variants`); sempre incluir handle `default`; sincronizar quando a lista de cases muda.
- Handler `switch.handler.ts` não precisa de mudança (já suporta o schema correto).

## Fora de escopo

- Outros inspectors
- Backend do switch handler (já completo)

## Arquivos permitidos

- `apps/web/features/flow-builder/nodes/switch/**`

## Arquivos proibidos

- `helpers-context.tsx`, `VariablesPicker.tsx` (só importar, não modificar)
- `nodeInspectors.ts`, `node-catalog.ts`, `nodeTypes.ts`

## Definition of Done

- [ ] Cases gerenciados via lista (add/remove), não text field com vírgula.
- [ ] `variable` selecionado via VariablesPicker.
- [ ] Toggle case-sensitive funcional.
- [ ] `SwitchNode` renderiza um handle de saída por case + `default`; atualiza ao editar cases.
- [ ] Edges existentes para cases removidos são automaticamente limpas pelo ReactFlow.
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## UX considerations

- Lista de cases: drag-to-reorder é nice-to-have (não bloqueador); add/remove é obrigatório.
- Máximo de cases: não impor limite na UI (o handler não limita); avisar se a lista estiver vazia.
- Handle `default` sempre presente e fixo (não removível) — representa o fallback quando nenhum case casa.
- Preview das edges inline no inspector (ex: `→ gold · → silver · → default`) — orienta o usuário antes de conectar.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

O padrão de edges dinâmicas está implementado em `ab_split/AbSplitNode.tsx` — reusar o padrão exato. Atenção: ao remover um case cuja edge já está conectada, o ReactFlow remove a edge automaticamente via `applyEdgeChanges` — não é necessário código extra para limpeza.
