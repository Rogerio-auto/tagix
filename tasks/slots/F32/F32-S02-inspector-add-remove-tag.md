---
id: F32-S02
title: Inspectors add_tag + remove_tag com TagPicker real
phase: F32
status: in-progress
priority: high
estimated_size: S
depends_on: []
blocks: []
source_docs:
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-06-15T21:29:35Z

---
# F32-S02 — Inspectors add_tag + remove_tag

## Objetivo

Substituir o `DeferredNotice` placeholder de `add_tag` e `remove_tag` por TagPicker real usando `helpers-context` — os handlers existem e são funcionais desde a F5.

## Contexto

Ambos os inspectors renderizam apenas `DeferredNotice()` com texto "Configuracao de tags/etapas entra com o dominio Pipeline (F5)." — aviso falso e obsoleto. Os handlers `add_tag.handler.ts` e `remove_tag.handler.ts` já executam em produção com `tagId: z.string().uuid()`. Falta só a UI.

## Escopo (faz)

- **`AddTagInspector.tsx`** — remover DeferredNotice; adicionar `TagPicker` que consome `useFlowHelpers().tags` (lista de `{ id, name, color }` do workspace); salva `tagId` no node data; preview do nome+cor da tag selecionada.
- **`RemoveTagInspector.tsx`** — idêntico ao AddTag; mesmo picker, mesmo campo `tagId`.
- Se `TagPicker` não existir como componente isolado, construir inline ou reusar o SelectField enriquecido com cor de tag.
- Remover import de `DeferredNotice` em ambos os arquivos.

## Fora de escopo

- `move_stage` (S03 separado)
- Criação de tags (redireciona para settings)

## Arquivos permitidos

- `apps/web/features/flow-builder/nodes/add_tag/**`
- `apps/web/features/flow-builder/nodes/remove_tag/**`

## Arquivos proibidos

- `helpers-context.tsx` — só lê, não modifica
- `inspector-fields.tsx` — se precisar de componente novo, criar dentro do diretório do node
- `nodeInspectors.ts`, `node-catalog.ts`

## Definition of Done

- [ ] Inspector `add_tag` renderiza lista de tags do workspace via picker (nome + cor); salva `tagId` válido.
- [ ] Inspector `remove_tag` idem.
- [ ] DeferredNotice removido de ambos.
- [ ] Estado vazio (sem tags no workspace) exibe hint "Crie tags em Configurações".
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## UX considerations

- Tag exibida com chip colorido (cor da tag) à esquerda do nome — não só texto cru.
- Picker via `<Select>` ou combobox; não text field (seria anti-pattern gear-only entry).
- Placeholder: "Selecione uma tag".

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

`useFlowHelpers()` vem de `helpers-context.tsx`. Verificar se `tags` já está exposto (F31-S03 expandiu o context — deve estar). Se não, o engineer deve adicionar ao context como parte deste slot (mas `helpers-context.tsx` está proibido de modificação neste slot — nesse caso, criar um hook local `useWorkspaceTags` consumindo a API diretamente).
