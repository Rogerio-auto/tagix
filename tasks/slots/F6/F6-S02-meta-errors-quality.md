---
id: F6-S02
title: Meta error codes map + channel quality/template helpers (packages/channels)
phase: F6
status: in-progress
priority: high
estimated_size: S
depends_on: []
agent_id: backend-engineer
claimed_at: 2026-06-11T04:45:41Z

---
# F6-S02 — Meta errors + quality

> **source_docs:** `docs/features/CAMPAIGNS.md` §5, §7, §10; `docs/ROADMAP.md` F6-S06 (parte map)
> **blocks:** F6-S03, F6-S05

## Objetivo
Primitivos Meta para campanhas: mapa de error codes → ação (`packages/channels/src/meta/errors.ts`, §10) e helpers de Graph API `fetchChannelQuality` (quality rating GREEN/YELLOW/RED + tier limit) e `fetchMetaTemplate` (status APPROVED + categoria) — consumidos pela validação (F6-S03) e pelo worker (F6-S05).

## Escopo (faz)
- `packages/channels/src/meta/errors.ts`: `META_ERROR_ACTIONS` mapeando 130472/131026/131047/131051/131008/132001 → `{ action: 'pause'|'mark_invalid'|'mark_reengage'|'increment_block'|'fail'|'pause_campaign', ... }` (§10).
- `packages/channels/src/meta/quality.ts`: `fetchChannelQuality(channel)` + `fetchMetaTemplate(channel, name)` via graphClient existente (F1-S09).

## Fora de escopo
- Auto-pause/handling no worker (F6-S05 usa o mapa), validação (F6-S03), schema.

## Arquivos permitidos
- `packages/channels/src/meta/errors.ts`
- `packages/channels/src/meta/quality.ts`
- `packages/channels/src/index.ts`

## Definition of Done
- [ ] Mapa cobre os 6 códigos do §10 com ação tipada; `fetchChannelQuality`/`fetchMetaTemplate` retornam shape tipado (Graph API mockada em teste).
- [ ] `pnpm --filter @hm/channels test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/channels test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Reusa o `graphClient` de F1-S09. Quality rating é a base do rate adaptativo (§7) e do auto-pause em RED.
