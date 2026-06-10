---
id: F1-S26
title: Worker bootstrap + persistência direta (@hm/db) + adapter factory
phase: F1
status: review
priority: critical
estimated_size: L
depends_on: [F1-S04, F1-S07, F1-S10, F1-S20, F1-S21]
agent_id: backend-engineer
claimed_at: 2026-06-10T01:31:55Z
completed_at: 2026-06-10T01:31:57Z

---
# F1-S26 — Worker bootstrap + persistência

> **source_docs:** `docs/ARCHITECTURE.md` §4.2 (composition roots em `apps/workers/src/<name>/index.ts`; workers usam `@hm/db`)
> **gap:** S04/S07 abstraíram persistência em ports mas publicavam pra um "DB-owner consumer" fantasma. Falta o composition root que dá boot nos workers e implementa os ports com `@hm/db`.

## Objetivo
Tornar a pipeline de canais funcional ponta-a-ponta: (1) implementar os ports de persistência (inbound/outbound/media/status) DIRETO com `@hm/db` + `withWorkspace` (RLS) — sem indireção MQ fantasma; (2) **inbound persist real**: dedup → ensure contact → ensure conversation → insert messages → update last_message/unread → bump cache → emit `message:new` → (ai_mode='on') enqueue agent/flow; (3) branch de `status` (S20) e emit de presença inbound (S21) ligados na pipeline; (4) **adapter factory** (provider→adapter com GraphClient/WahaClient configurados a partir de channel/platform secrets); (5) **bootstrap** que conecta MQ, monta deps e dá start em inbound/outbound/media.

## Escopo (faz)
- `apps/workers/src/bootstrap/**` — entrypoint(s) de processo: `connectMq` + `assertTopology` + adapter factory + `createXDeps` + `startInbound/Outbound/MediaWorker`.
- `apps/workers/src/inbound/**` — refatorar persist port para `@hm/db` direto; ligar status (S20) e presença (S21); remover a indireção `persist.requested` fantasma.
- `apps/workers/src/outbound/**` — `finalize` persiste via `@hm/db` (view_status/external_id) + emit.
- `apps/workers/src/index.ts` — exports do bootstrap.

## Arquivos permitidos
- `apps/workers/src/bootstrap/**`, `apps/workers/src/inbound/**`, `apps/workers/src/outbound/**`, `apps/workers/src/media/**`, `apps/workers/src/index.ts`

## Definition of Done
- [ ] Inbound persiste de verdade (contact/conversation/message, RLS) e emite `message:new`.
- [ ] Outbound `finalize` e media `update` persistem via `@hm/db`.
- [ ] Status (S20) e presença inbound (S21) acionados na pipeline.
- [ ] Bootstrap dá boot nos consumers; adapter factory resolve provider→adapter.
- [ ] `pnpm --filter @hm/workers typecheck/test`; sem `any`.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```
