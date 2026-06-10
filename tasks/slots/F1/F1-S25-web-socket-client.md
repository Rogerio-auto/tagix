---
id: F1-S25
title: Web socket client — SocketProvider + window.__hmSocket (liga o realtime)
phase: F1
status: done
priority: critical
estimated_size: M
depends_on: [F1-S11, F0-S11]
agent_id: backend-engineer
claimed_at: 2026-06-10T01:31:41Z
completed_at: 2026-06-10T01:31:42Z

---
# F1-S25 — Web socket client (realtime transport)

> **source_docs:** `docs/features/LIVECHAT.md` §6; `packages/shared/src/socket-events.ts`
> **gap:** S11/S14/S20/S21/S22 são transport-agnostic e leem `window.__hmSocket`, mas nada conecta um client. Todo o realtime está inerte.

## Objetivo
Provider de Socket.io client: conecta na API (`NEXT_PUBLIC_API_URL`), autentica (cookie/credentials), entra nas rooms (workspace + conversa ativa), e expõe o client tipado contra `@hm/shared` `ServerToClient` em `window.__hmSocket` — acendendo todos os hooks já existentes. Reconexão + cleanup.

## Escopo (faz)
- `apps/web/shared/realtime/SocketProvider.tsx` — `'use client'`; cria a conexão (`socket.io-client`), seta `window.__hmSocket` (tipado, compatível com a global já declarada em `features/conversations/hooks/useConversationSocket.ts`), entra/sai de rooms, trata connect/disconnect/reconnect, limpa no unmount.
- `apps/web/shared/realtime/useSocket.ts` — hook de acesso + helpers `joinConversation(id)`/`leaveConversation(id)`.
- `apps/web/shared/realtime/index.ts` — barrel.

## Arquivos permitidos
- `apps/web/shared/realtime/**`

## Definition of Done
- [ ] Conecta e seta `window.__hmSocket`; hooks transport-agnostic recebem eventos (`message:new`, `typing:from_contact`, `message:status_changed`, `conversation:updated`, `note:mentioned`).
- [ ] Join/leave de room por conversa ao navegar; reconexão automática.
- [ ] Tipado contra `ServerToClient` (zero `any`); typecheck + lint.
- [ ] NOTA: depende de `socket.io-client` (o orquestrador adiciona ao package.json + monta o `<SocketProvider>` em `app/providers.tsx`).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```
