---
id: F1-S12
title: API GET /conversations + /conversations/:id/messages + cache versioning
phase: F1
status: blocked
priority: critical
estimated_size: M
depends_on: [F1-S05, F0-S06]
---

# F1-S12 — API conversations

> **source_docs:** `docs/features/LIVECHAT.md` §7.2, §8 (cache)
> **blocks:** F1-S13, F1-S14, F1-S16

## Objetivo
Rotas de leitura do inbox com filtros, cursor pagination e cache Redis versionado.

## Escopo (faz)
- `apps/api/src/routes/conversations/**` — `GET /api/conversations` (filtros: status/department/team/assigned/tag/provider; search; sort last_message_at; lazy 50+cursor), `GET /api/conversations/:id/messages` (cursor). Protegido por requireAuth + withRLS + requireRole('conversation.view').
- `apps/api/src/cache/**` — helpers de cache (`hm:conv:list:*`, `hm:conv:{id}`, `hm:msg:*`) com bump de versão em writes (LIVECHAT §8).

## Arquivos permitidos
- `apps/api/src/routes/conversations/**`, `apps/api/src/cache/**`, `apps/api/src/app.ts`

## Definition of Done
- [ ] Listagem com filtros + paginação; messages com cursor; cache hit/invalidate corretos.
- [ ] requireRole aplicado; typecheck + lint + teste de integração (lista escopada ao workspace).

## Permission scope
- `conversation.view` (todos os roles, AGENT escopado às suas — filtro no service). Vide PERMISSIONS.md §2.1.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
Single-flight (redlock) em `getConversation` evita thundering herd no cache miss.
