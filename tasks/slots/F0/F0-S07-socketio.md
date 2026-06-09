---
id: F0-S07
title: Socket.io + Redis adapter + rooms por workspace/member
phase: F0
status: done
priority: high
estimated_size: S
depends_on: [F0-S06]
agent_id: backend-engineer
claimed_at: 2026-06-09T22:15:25Z
completed_at: 2026-06-09T22:16:27Z

---
# F0-S07 — Socket.io + Redis adapter

> **source_docs:** `docs/ARCHITECTURE.md` §Real-time; `docs/INFRASTRUCTURE.md`
> **blocks:** relay de mensagens (F1)

## Objetivo

Camada real-time com Socket.io + adapter Redis, autenticada pela mesma sessão, com rooms automáticas por workspace e member.

## Escopo (faz)

- `apps/api/src/socket/**` — init Socket.io no server HTTP, `@socket.io/redis-adapter` (ioredis), middleware de auth (reusa sessão/IAuthProvider), join automático em `ws:<workspaceId>` e `member:<memberId>`, emit `member:online`.
- Helper tipado de emit por room.

## Arquivos permitidos

- `apps/api/src/socket/**`, `apps/api/src/server.ts` (montar io)

## Definition of Done

- [ ] Client conecta autenticado e entra nas rooms; recebe `member:online`.
- [ ] Redis adapter configurado (escala multi-processo).
- [ ] `pnpm typecheck`, `pnpm lint` limpos.

## Validação

```bash
pnpm typecheck
pnpm lint
```

## Notas

- `server.ts` é compartilhado com F0-S06; este slot depende de S06 (sequencial, sem paralelismo).
