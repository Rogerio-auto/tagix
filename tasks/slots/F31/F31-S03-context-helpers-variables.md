---
id: F31-S03
title: Infra de contexto — helpers-context + VariablesPicker completos
phase: F31
status: in-progress
priority: high
estimated_size: M
depends_on: []
blocks: [F31-S04, F31-S05, F31-S06, F31-S07, F31-S08]
source_docs:
  - docs/features/FLOW_BUILDER.md
agent_id: backend-engineer
claimed_at: 2026-06-15T12:47:13Z

---
# F31-S03 — Infra de contexto (pickers & variáveis)

## Objetivo

Dar a todos os inspectors a base para escolher recursos por **picker** (não id em texto cru) e referenciar **variáveis** completas. Slot de infra compartilhada que destrava a Onda 2 e os novos nodes.

## Contexto

`helpers-context.tsx` hoje expõe agents/channels/tags/stages mas faltam pipelines/conversion-types/meta-flows/custom-fields/members. `VariablesPicker.tsx` tem só 7 vars hardcoded. Inspectors usam id cru por falta dessa base.

## Escopo (faz)

- `apps/web/features/flow-builder/shared/helpers-context.tsx` — adicionar providers/hooks para pipelines, conversion-types, meta-flows, custom-fields, members (reusando hooks de dados existentes do web).
- `apps/web/features/flow-builder/inspector/VariablesPicker.tsx` — catálogo de variáveis completo (contato, conversa, respostas de nodes anteriores, webhook_response, variáveis de `set_variable`), agrupado e pesquisável.
- Componentes de picker reutilizáveis (agent/channel/tag/stage/pipeline) se ainda não existirem como peça compartilhada.

## Fora de escopo

- Consumo nos inspectors específicos (S04-S07). Novos nodes (Onda 4).

## Arquivos permitidos

- `apps/web/features/flow-builder/shared/helpers-context.tsx`
- `apps/web/features/flow-builder/inspector/VariablesPicker.tsx`
- `apps/web/features/flow-builder/inspector/pickers/**`

## Arquivos proibidos

- `apps/web/features/flow-builder/inspector/InspectorPanel.tsx` (dono: S08), qualquer `nodes/**`.

## Definition of Done

- [ ] helpers-context expõe os 5 novos domínios; VariablesPicker lista todas as fontes.
- [ ] Pickers reutilizáveis prontos para os inspectors.
- [ ] `pnpm typecheck` + `pnpm lint` + testes verdes.

## UX considerations

- `UX_PRINCIPLES`: substituir id-em-texto-cru por picker pesquisável; variáveis com agrupamento legível (não chaves opacas).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

- Não duplicar fetch: reusar os hooks de dados já existentes (useDepartments/useTeams/useTags/usePipelines etc.). Relacionado: [[tagix-flow-builder-v2-survey]].
