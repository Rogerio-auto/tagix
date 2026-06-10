---
id: F5-S10
title: Frontend DealDetailDrawer + history timeline + CardImageCapture/gallery
phase: F5
status: review
priority: high
estimated_size: M
depends_on: [F5-S05]
agent_id: backend-engineer
claimed_at: 2026-06-10T22:49:46Z
completed_at: 2026-06-10T22:53:39Z

---
# F5-S10 — DealDetailDrawer (web)

> **source_docs:** `docs/features/PIPELINE.md` §5.1, §5.4, §9.3; `docs/UX_PRINCIPLES.md` §2/§3; `docs/ROADMAP.md` F5-S04, F5-S08 (parte UI)
> **blocks:** —

## Objetivo
Drawer de detalhe do deal (slide-in): header (título/valor/stage/status), contact summary, notes, **history timeline** (`deal_history`), **attachments gallery** com `CardImageCapture` (câmera traseira + GPS/EXIF + overlay) e link para a conversa associada.

## Escopo (faz)
- `apps/web/features/pipeline/deal/**`: `DealDetailDrawer` (sections §9.3), `HistoryTimeline`, `CardImageCapture` (getUserMedia env-facing + canvas + `useGeolocation` + overlay), `CardImageGallery` (carrossel + metadata + delete), upload via signed URL (§5.2).
- Render dos custom fields é injetado pelo componente de F5-S11 (não duplicar aqui).

## Fora de escopo
- Editor de custom field defs / dynamic form (F5-S11), kanban (F5-S09), API (F5-S05).

## Arquivos permitidos
- `apps/web/features/pipeline/deal/**`

## Definition of Done
- [ ] Drawer abre do card com todas as sections; timeline renderiza `deal_history`; gallery faz capture→signed URL→POST e exibe metadata/overlay; delete por item.
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes.

## UX considerations
- §2 drawer lateral (não modal full-screen — anti-padrão v1); §3 estados loading/empty/error 3-partes; câmera com fallback claro se sem permissão/HTTPS; overlay legível; tokens DS v2 (zero hex).

## Permission scope
- Editar deal/anexos → `deal.edit` (STAFF).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- `CardImageCapture`/`useGeolocation` são ports do v1 — mantenha a UX (overlay com timestamp/lat-lon/cidade) mas no DS v2.
