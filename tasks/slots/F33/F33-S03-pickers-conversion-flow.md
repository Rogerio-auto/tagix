---
id: F33-S03
title: ConversionTypePicker + FlowPicker nos inspectors
phase: F33
status: review
priority: medium
estimated_size: S
depends_on: []
blocks: []
source_docs:
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-06-15T21:57:17Z
completed_at: 2026-06-15T22:00:38Z

---
# F33-S03 — ConversionTypePicker + FlowPicker

## Objetivo

Substituir os campos de texto livre (`TextField` com UUID/key crua) nos inspectors `register_conversion` e `go_to_flow` por ComboBoxes que consomem as APIs existentes — eliminando os últimos anti-patterns de "id em texto cru" no Flow Builder.

## Contexto

Dois inspectors ainda pedem ID/chave em texto livre:

1. **`register_conversion`** — campo `conversionTypeKey` é `TextField`. A API `GET /api/conversion-types` existe (F5) e retorna `{ id, key, label, valueCents }[]` por workspace.

2. **`go_to_flow`** — campo `flowId` é `TextField` com placeholder UUID. A API `GET /api/flows` existe (F4) e retorna `{ id, name, status }[]` por workspace.

Ambas as APIs já passam pelo workspace RLS — nenhuma mudança de backend necessária.

## Escopo (faz)

- **`apps/web/features/flow-builder/nodes/register_conversion/**`** — substituir `TextField` por ComboBox (ou Select) que:
  - Fetch de `/api/conversion-types` (SWR ou fetch inline).
  - Exibe `label` ao usuário; salva `key` no node data (o handler aceita `conversionTypeKey`).
  - Opção selecionada mostra `label` + `key` como subtexto.
  - Estado vazio: "Nenhum tipo de conversão criado — configure em Configurações".

- **`apps/web/features/flow-builder/nodes/go_to_flow/**`** — substituir `TextField` por ComboBox que:
  - Fetch de `/api/flows?status=active` (só flows ativos/publicados fazem sentido como destino).
  - Exibe `name` ao usuário; salva `id` no node data.
  - Filtra o flow atual da lista (um flow não deve se chamar recursivamente via go_to_flow — o guard de profundidade já existe, mas a UI deve evitar loops óbvios).
  - Estado vazio: "Nenhum flow ativo encontrado — publique um flow primeiro".

- Remover comentário de seam `// SEAM: when /api/flows provides public listing` do inspector `go_to_flow`.
- Remover TODO `// when the picker exposes the key directly` do inspector `register_conversion`.

## Fora de escopo

- Criação de conversion types na UI (redireciona para Settings)
- Criação de flows in-canvas (fora de escopo)
- Mudanças de API/backend

## Arquivos permitidos

- `apps/web/features/flow-builder/nodes/register_conversion/**`
- `apps/web/features/flow-builder/nodes/go_to_flow/**`

## Arquivos proibidos

- `apps/api/**`, `packages/db/**`
- `helpers-context.tsx` (não adicionar ao context — fetch inline é suficiente para esses dois casos)
- `nodeInspectors.ts`, `node-catalog.ts`

## Definition of Done

- [ ] Inspector `register_conversion` exibe lista de tipos de conversão do workspace; salva `conversionTypeKey` correto.
- [ ] Inspector `go_to_flow` exibe lista de flows ativos; salva `flowId` correto.
- [ ] Flow atual não aparece na lista do `go_to_flow` (evita loop óbvio).
- [ ] Estados de loading e vazio tratados (skeleton/hint).
- [ ] Comentários de seam/TODO removidos.
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## UX considerations

- Picker com busca por texto (ComboBox, não Select puro) para workspaces com muitos flows/tipos.
- Loading state: skeleton de 1 linha enquanto fetcha (não bloquear o inspector).
- Erro de fetch: "Erro ao carregar — tente novamente" com botão retry inline.
- Não usar `useFlowHelpers` (context global) — fetch local por SWR ou `useSWR` evita penalizar todos os inspectors com mais dados.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

Para o `go_to_flow`, o `flowId` do flow atual está disponível em `useFlowEditor((s) => s.flowId)` (ou equivalente no store) — usar para filtrar da lista. Se o store não expõe `flowId`, ler do contexto da página (URL param ou prop passada ao canvas).
