---
id: F1-S11
title: Socket relay — hm.q.socket.relay → io.emit + socket-events tipados
phase: F1
status: done
priority: high
estimated_size: S
depends_on: [F0-S07, F1-S05]
agent_id: backend-engineer
claimed_at: 2026-06-10T00:15:13Z
completed_at: 2026-06-10T00:16:01Z

---
# F1-S11 — Socket relay

> **source_docs:** `docs/features/LIVECHAT.md` §6
> **blocks:** F1-S14, F1-S20, F1-S21

## Objetivo
A API consome `hm.q.socket.relay` e emite os eventos tipados via Socket.io para as rooms `conversation:{id}`, `workspace:{wsId}`, `member:{id}`.

## Escopo (faz)
- `packages/shared/src/socket-events.ts` — `ServerToClient` map (message:new, message:status_changed, message:media_ready, conversation:updated, typing:from_contact, …) exportado para tipar io e o client.
- `apps/api/src/socket/relay.ts` — consumer amqp → `io.to(room).emit(event, payload)`; join em `conversation:{id}` on demand.

## Arquivos permitidos
- `packages/shared/src/socket-events.ts`, `packages/shared/src/index.ts`, `apps/api/src/socket/relay.ts`, `apps/api/src/socket/index.ts`

## Definition of Done
- [ ] Eventos tipados compartilhados; relay emite para as rooms corretas.
- [ ] typecheck + lint.

## Validação
```bash
pnpm typecheck
pnpm lint
```

## Notas
Reusa o io de F0-S07. socket-events são tipos puros (ok no barrel de @hm/shared).
