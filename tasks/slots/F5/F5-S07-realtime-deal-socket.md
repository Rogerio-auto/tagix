---
id: F5-S07
title: Real-time deals — socket events deal:* + relay + client listeners
phase: F5
status: blocked
priority: medium
estimated_size: S
depends_on: [F5-S05]
---
# F5-S07 — Real-time deal sync

> **source_docs:** `docs/features/PIPELINE.md` §6; `docs/ROADMAP.md` F5-S10
> **blocks:** F5-S09

## Objetivo
Sincronização em tempo real do pipeline: eventos `deal:created`/`updated`/`stage_changed`/`deleted` e `pipeline:updated` emitidos no servidor (via seam de F5-S05) e relayados para os clientes do workspace; tipos no `socket-events.ts` compartilhado.

## Escopo (faz)
- `packages/shared/src/socket-events.ts`: adicionar os 5 eventos `deal:*`/`pipeline:*` (§6.1) ao `SERVER_TO_CLIENT_EVENTS` tipado.
- `apps/api/src/services/deal-events.ts` (ou hook no seam `onStageChanged`/CRUD): publica os eventos via o relay de socket existente (F1-S11) com room por workspace.

## Fora de escopo
- Listeners de UI/optimistic update (vão na PipelinePage, F5-S09 — aqui só o canal server-side + tipos).

## Arquivos permitidos
- `packages/shared/src/socket-events.ts`
- `apps/api/src/services/deal-events.ts`

## Definition of Done
- [ ] Os 5 eventos tipados em `socket-events.ts`; move/CRUD de deal emitem para a room do workspace.
- [ ] `pnpm --filter @hm/api test` + lint/typecheck verdes (incl. validação do relay contra `SERVER_TO_CLIENT_EVENTS`).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- O relay valida o nome do evento contra `SERVER_TO_CLIENT_EVENTS` (lição do F2-S11) — por isso os tipos vêm primeiro.
