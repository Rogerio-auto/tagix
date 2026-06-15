---
id: F31-S06
title: Inspectors condition (pickers+business-hours), external_notify e ai_action
phase: F31
status: review
priority: medium
estimated_size: M
depends_on: [F31-S01, F31-S03]
blocks: []
source_docs:
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-06-15T13:10:04Z
completed_at: 2026-06-15T13:10:42Z

---
# F31-S06 — Inspectors condition + external_notify + ai_action

## Objetivo

Fechar os três inspectors menores: `condition` (picker de tag/stage + business-hours), `external_notify` (customPhone para CUSTOM + picker de canal), `ai_action` (picker de agente).

## Contexto

Hoje: condition sem pickers nem business-hours; external_notify com channelId em texto cru e sem customPhone (target CUSTOM inusável); ai_action com id de agente cru. external_notify é saída → depende do bridge (S01).

## Escopo (faz)

- `apps/web/features/flow-builder/nodes/condition/**` — picker de tag/stage, config de business-hours; usa edges true/false.
- `apps/web/features/flow-builder/nodes/external_notify/**` — `customPhone` para target CUSTOM + picker de canal.
- `apps/web/features/flow-builder/nodes/ai_action/**` — picker de agente.
- Handlers correspondentes (`condition`, `external_notify`, `ai_action`) ajustados se a UI mandar campos novos.

## Fora de escopo

- Infra de contexto (S03), outros inspectors.

## Arquivos permitidos

- `apps/web/features/flow-builder/nodes/condition/**`
- `apps/web/features/flow-builder/nodes/external_notify/**`
- `apps/web/features/flow-builder/nodes/ai_action/**`
- `packages/flow-engine/src/handlers/condition.handler.ts`
- `packages/flow-engine/src/handlers/external_notify.handler.ts`
- `packages/flow-engine/src/handlers/ai_action.handler.ts`

## Arquivos proibidos

- `helpers-context.tsx`, `VariablesPicker.tsx`, `InspectorPanel.tsx`, `registry.ts`, `node-catalog.ts`.

## Definition of Done

- [ ] condition com pickers + business-hours roteando true/false.
- [ ] external_notify notifica via canal escolhido / customPhone.
- [ ] ai_action seleciona agente por picker.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## UX considerations

- `UX_PRINCIPLES`: pickers no lugar de id cru; business-hours com UI legível (não cron cru).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
pnpm --filter @hm/web test
```

## Notas

Relacionado: [[tagix-flow-builder-v2-survey]].
