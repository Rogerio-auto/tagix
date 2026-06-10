---
id: F4-S09
title: Frontend FlowsListPage + manual flows drag-reorder
phase: F4
status: blocked
priority: high
estimated_size: M
depends_on: [F4-S08]
---
# F4-S09 — FlowsListPage (web)

> **source_docs:** `docs/features/FLOW_BUILDER.md` §9.2, §9.4, §10; `docs/UX_PRINCIPLES.md` §2/§3; `docs/features/PERMISSIONS.md` §5 (flow.*); `docs/ROADMAP.md` F4-S10
> **blocks:** —

## Objetivo
Tela de lista de flows (DS v2): grid/lista com status (draft/active/paused/archived), criar flow draft, ações (publicar/pausar/arquivar), e reordenação drag-and-drop dos flows `manual` (`manual_position` via `PATCH /api/flows/manual-order`). Consome a API de F4-S08.

## Escopo (faz)
- `apps/web/app/(app)/flows/**`: rota da lista (App Router).
- `apps/web/features/flow-builder/list/**`: `FlowsListPage`, `FlowCard` (status badge), `CreateFlowModal/Drawer`, `ManualFlowsReorder` (dnd-kit), `queries.ts`/`types.ts`.
- Item de navegação "Flows" na Sidebar, gated por `can('flow.list')`.

## Fora de escopo
- Editor/canvas (F4-S10/S11), integração LiveChat (F4-S12).

## Arquivos permitidos
- `apps/web/app/(app)/flows/**`
- `apps/web/features/flow-builder/list/**`
- `apps/web/shared/components/layout/Sidebar.tsx`

## Definition of Done
- [ ] Lista com status, criar draft, publicar/pausar/arquivar; reorder manual persiste `manual_position`.
- [ ] Ações de escrita gated por `can('flow.edit')`/`can('flow.publish')`; nav por `can('flow.list')`.
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes.

## UX considerations
- §2 navegação clara (Flows como item 1ª classe, sem gear-only entry); §2.7 skeleton; estados default/empty/error 3-partes.
- §3 reorder com feedback de drag suave (sem overlap de texto — evitar o anti-padrão drag-text do v1); tokens DS v2 (zero hex).

## Permission scope
- Página/nav por `flow.list` (ALL); criar/publicar/arquivar por `flow.edit`/`flow.publish` (ADMINS). Esconder ações sem permissão.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- Única slot da F4 que toca a Sidebar — sem colisão intra-fase.
