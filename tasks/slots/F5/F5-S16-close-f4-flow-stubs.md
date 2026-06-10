---
id: F5-S16
title: Fecha stubs da F4 — handlers move_stage/add_tag/remove_tag + triggers stage_change/tag_added
phase: F5
status: review
priority: high
estimated_size: M
depends_on: [F5-S01, F5-S02, F5-S05]
agent_id: backend-engineer
claimed_at: 2026-06-10T22:20:09Z
completed_at: 2026-06-10T22:23:48Z

---
# F5-S16 — Fechar stubs de flow da F4

> **source_docs:** `docs/features/FLOW_BUILDER.md` §4.1, §5; [[tagix-f4-decomposition]] (stub-até-F5); `docs/ROADMAP.md` F4↔F5
> **blocks:** —

## Objetivo
Agora que deals/stages (F5-S02) e tags/contact_tags (F5-S01) existem, implementar de verdade os handlers e triggers que ficaram stub-guard na F4: handlers `move_stage` (via `moveDealToStage`), `add_tag`/`remove_tag` (via `contact_tags`), e o dispatch dos triggers `stage_change` e `tag_added`.

## Escopo (faz)
- `packages/flow-engine/src/handlers/move_stage.handler.ts`: move via o serviço `moveDealToStage` (F5-S05), actor `system`/`flow`.
- `packages/flow-engine/src/handlers/add_tag.handler.ts` + `remove_tag.handler.ts`: insert/delete em `contact_tags` (RLS) pelo ctx.
- `apps/workers/src/flows-triggers/**` (estende F4-S13): `dispatchTriggersForStageChange` (chamado pelo seam `onStageChanged` de F5-S05) e `dispatchTriggersForTagAdded` (chamado na aplicação de tag / via o trigger pg).
- `condition` HAS_TAG/IN_STAGE deixam de degradar: passam a avaliar de verdade (consultam contact_tags/deals).

## Fora de escopo
- Engine core (F4-S02), serviço de move (F5-S05), conversão por tag (F5-S14 — trigger pg próprio).

## Arquivos permitidos
- `packages/flow-engine/src/handlers/move_stage.handler.ts`
- `packages/flow-engine/src/handlers/add_tag.handler.ts`
- `packages/flow-engine/src/handlers/remove_tag.handler.ts`
- `packages/flow-engine/src/handlers/condition.handler.ts`
- `apps/workers/src/flows-triggers/**`

## Definition of Done
- [ ] `move_stage`/`add_tag`/`remove_tag` executam de verdade (com history/RLS); `condition` HAS_TAG/IN_STAGE avaliam corretamente.
- [ ] Mudança de stage dispara flows `stage_change`; aplicação de tag dispara flows `tag_added` (teste cobre match/no-match).
- [ ] `pnpm --filter @hm/flow-engine test` + `pnpm --filter @hm/workers test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
pnpm --filter @hm/workers test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Este slot encerra formalmente a dívida stub-até-F5 registrada em [[tagix-f4-decomposition]]. `move_stage` reusa `moveDealToStage` — não reimplementa transition/automation.
