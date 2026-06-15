---
id: F31-S07
title: Triggers configuráveis (tipo editável + trigger_config UI)
phase: F31
status: done
priority: high
estimated_size: M
depends_on: [F31-S03]
blocks: []
source_docs:
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-06-15T13:10:51Z
completed_at: 2026-06-15T13:11:24Z

---
# F31-S07 — Triggers configuráveis

## Objetivo

Tornar o gatilho **editável após a criação** e expor a UI de `trigger_config` para todos os 8 tipos (keyword, stage ids, message_types, source, event).

## Contexto

Hoje o tipo do trigger é escolhido só no `CreateFlowModal` (5 de 8 tipos) e nunca mais editável; `trigger_config` não tem UI → keyword/new_lead/new_message/stage_change são não-configuráveis. O node `trigger` já tem inspector (`nodes/trigger/`), mas raso.

## Escopo (faz)

- `apps/web/features/flow-builder/nodes/trigger/**` — editor de tipo de trigger (8 tipos) + form de `trigger_config` por tipo (keyword com match; stage ids via picker; message_types; source; event). Usa pickers de S03.
- `packages/flow-engine/src/handlers/trigger.handler.ts` — validar/consumir `trigger_config` se a UI mandar campos novos.

## Fora de escopo

- Infra de contexto (S03). Dispatcher de triggers (já existe, F4-S13).

## Arquivos permitidos

- `apps/web/features/flow-builder/nodes/trigger/**`
- `packages/flow-engine/src/handlers/trigger.handler.ts`

## Arquivos proibidos

- `helpers-context.tsx`, `VariablesPicker.tsx`, `nodeTypes.ts`, `nodeInspectors.ts`, `node-catalog.ts`, `registry.ts`, `list/CreateFlowModal.tsx`.

## Definition of Done

- [ ] Tipo do trigger editável após criação; os 8 tipos com config.
- [ ] keyword/stage_change/new_message/new_lead configuráveis e disparando corretamente.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## UX considerations

- `UX_PRINCIPLES`: config no inspector (não só no modal de criação); stage ids via picker (não texto cru); evita gear-only entry.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
pnpm --filter @hm/web test
```

## Notas

Relacionado: [[tagix-flow-builder-v2-survey]].
