---
id: F5-S09
title: Frontend PipelinePage kanban (dnd-kit + optimistic move + filtros) + PipelineSettingsPage
phase: F5
status: done
priority: high
estimated_size: L
depends_on: [F5-S04, F5-S05]
agent_id: backend-engineer
claimed_at: 2026-06-10T22:44:49Z
completed_at: 2026-06-10T22:49:23Z

---
# F5-S09 — PipelinePage kanban (web)

> **source_docs:** `docs/features/PIPELINE.md` §6.2, §9.1, §9.4; `docs/UX_PRINCIPLES.md` §2/§3; `docs/ROADMAP.md` F5-S03
> **blocks:** —

## Objetivo
Tela kanban do pipeline (DS v2): colunas por stage (com contadores), cards arrastáveis com **optimistic update + reconciliação via socket** (F5-S07), seletor de pipeline, filtros (owner/tag/date), criar deal. Mais a `PipelineSettingsPage` (stages: reorder, edit name/color/automation_rules/transition_rules, add/delete).

## Escopo (faz)
- `apps/web/app/(app)/pipeline/**`: rota kanban + settings.
- `apps/web/features/pipeline/board/**`: `PipelinePage`, `StageColumn`, `DealCard` (resumo §9.2), dnd-kit (horizontal stages + vertical cards), optimistic `onDragEnd` (§6.2), listeners socket `deal:*`.
- `apps/web/features/pipeline/settings/**`: `PipelineSettingsPage` + editores de `automation_rules`/`transition_rules`.
- Item de navegação "Pipeline" na Sidebar, gated por permissão.

## Fora de escopo
- DealDetailDrawer (F5-S10), custom fields (F5-S11), CardImageCapture (F5-S10/attachments), conversões (F5-S13).

## Arquivos permitidos
- `apps/web/app/(app)/pipeline/**`
- `apps/web/features/pipeline/board/**`
- `apps/web/features/pipeline/settings/**`
- `apps/web/shared/components/layout/Sidebar.tsx`

## Definition of Done
- [ ] Kanban com drag-drop optimista + revert em erro + reconciliação por socket; filtros e criar deal funcionam.
- [ ] Settings edita stages (reorder/automation/transition); nav gated por `can('deal.edit')`/`can('pipeline.edit')`.
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes.

## UX considerations
- §3 drag-drop com feedback (lift/shadow no hover, opacity 0.5 no drag — sem overlap de texto, anti-padrão v1); §2.7 skeleton por coluna; virtualização/cursor se muitos deals (§14); tokens DS v2 (zero hex).
- Warning de transition rule ANTES de permitir o drop (validação client-side espelhando §4.2).

## Permission scope
- Mover → `deal.move` (STAFF); editar pipeline/stages → `pipeline.edit` (ADMINS). Esconder ações sem permissão.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- Única slot da F5 que toca a Sidebar. Slot L — se passar de ~500 linhas, separe a SettingsPage num slot sequencial.
