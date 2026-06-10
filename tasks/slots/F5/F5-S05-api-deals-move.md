---
id: F5-S05
title: API deals + move-stage service (transition rules + history) + close/reopen + attachments
phase: F5
status: done
priority: high
estimated_size: L
depends_on: [F5-S02]
agent_id: backend-engineer
claimed_at: 2026-06-10T22:00:53Z
completed_at: 2026-06-10T22:05:38Z

---
# F5-S05 — API deals + move service

> **source_docs:** `docs/features/PIPELINE.md` §3.2, §4.2, §5.2, §10; `docs/features/PERMISSIONS.md` (deal.*); `docs/ROADMAP.md` F5-S02 (parte deals), F5-S06, F5-S08 (parte API)
> **blocks:** F5-S06, F5-S07, F5-S08, F5-S09, F5-S10, F5-S16

## Objetivo
API de deals + o serviço central `moveDealToStage` (validação de transition rules §4.2 + update + `deal_history` + **seams** para automation dispatch e socket emit), close-won/lost/reopen, e os endpoints de `deal_attachments` (signed URL + persist + list/delete).

## Escopo (faz)
- `apps/api/src/routes/deals/**`: deals CRUD (`GET ?pipelineId`, POST, `GET/PUT /:id`), `POST /:id/move-stage` (→ `moveDealToStage`), `close-won`/`close-lost`/`reopen`, `GET /:id/history`, e `GET/POST/DELETE /:id/attachments`.
- `apps/api/src/services/deal-move.ts`: `moveDealToStage(dealId, newStageId, actor)` = validateTransition (§4.2) → update → insert `deal_history` → **chama hooks** `onStageChanged` (automation+trigger+socket, preenchidos por F5-S06/S07/S16 via seam) — exponha um event/port, não acople.
- Attachments: integra com storage R2 (F0-S15) — signed URL + valida ownership + persiste EXIF/GPS.

## Fora de escopo
- Automation worker (F5-S06), socket relay (F5-S07), trigger stage_change (F5-S16), UI (F5-S10/S12), agent tool (F5-S08).

## Arquivos permitidos
- `apps/api/src/routes/deals/**`
- `apps/api/src/services/deal-move.ts`

## Permission scope
- `move-stage`/close/reopen → `deal.move`/`deal.edit` (STAFF); CRUD → `deal.edit` (STAFF). Cite `permissions.ts`.

## Definition of Done
- [ ] CRUD deals + move com validação de transition rules (allowed_from/required_fields/required_roles) + `deal_history` registrado; close/reopen setam `closed_at`/`closed_won`.
- [ ] Attachments: signed URL + persist (EXIF/GPS) + list/delete sob RLS.
- [ ] `moveDealToStage` expõe seam `onStageChanged` (sem acoplar automation/socket).
- [ ] `pnpm --filter @hm/api test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- `moveDealToStage` é reusado pelo agent tool (F5-S08) e pelo handler `move_stage` da F4 (F5-S16) — fixe a assinatura aqui.
