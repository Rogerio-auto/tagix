---
id: F31-S04
title: Inspector interactive completo (botões reply/url/phone + listas)
phase: F31
status: done
priority: high
estimated_size: M
depends_on: [F31-S01, F31-S03]
blocks: []
source_docs:
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-06-15T13:06:45Z
completed_at: 2026-06-15T13:09:13Z

---
# F31-S04 — Inspector interactive completo

## Objetivo

O node `interactive` passa a definir **botões** (reply / url / phone) e **listas** (sections + rows) com header/footer — paridade total com o handler.

## Contexto

Hoje o inspector só edita kind+body; o handler já suporta buttons/sections/header/footer mas a UI não expõe. É um node de saída → depende do bridge (S01) para envio real.

## Escopo (faz)

- `apps/web/features/flow-builder/nodes/interactive/**` — editor de botões (tipos reply/url/phone), editor de listas (sections com rows), header/footer; validação Zod no submit; estados de erro DS v2.
- `packages/flow-engine/src/handlers/interactive.handler.ts` — ajustar schema se a UI passar campos novos.
- Usa pickers/variáveis de S03.

## Fora de escopo

- Bridge (S01), infra de contexto (S03), outros inspectors.

## Arquivos permitidos

- `apps/web/features/flow-builder/nodes/interactive/**`
- `packages/flow-engine/src/handlers/interactive.handler.ts`

## Arquivos proibidos

- `helpers-context.tsx`, `VariablesPicker.tsx`, `InspectorPanel.tsx`, `registry.ts`, `node-catalog.ts`.

## Definition of Done

- [ ] Cria botões reply/url/phone e listas com sections/rows; envia via canal e renderiza correto.
- [ ] Validação de limites do provider (nº de botões/rows).
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## UX considerations

- `UX_PRINCIPLES`: editor estruturado (não JSON cru); preview do interactive; limites do provider sinalizados inline.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
pnpm --filter @hm/web test
```

## Notas

Relacionado: [[tagix-flow-builder-v2-survey]].
