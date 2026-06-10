---
id: F1-S22
title: Notas internas com mentions (conversation_notes + auto-notification)
phase: F1
status: done
priority: medium
estimated_size: M
depends_on: [F1-S05, F1-S12]
agent_id: backend-engineer
claimed_at: 2026-06-10T00:44:59Z
completed_at: 2026-06-10T00:45:00Z

---
# F1-S22 — Notas internas + mentions

> **source_docs:** `docs/features/LIVECHAT.md` §7.4; `docs/features/DASHBOARD.md` (notificações)
> **blocks:** —

## Objetivo
Notas internas por conversa, com menção `@member` que gera notificação ao mencionado.

## Escopo (faz)
- `packages/db/src/schema/conversation_notes.ts` (+ RLS, migration).
- `apps/api/src/routes/conversations/notes.ts` — CRUD de notas + parse de mentions → cria `notifications` (member:{id} socket).
- Frontend: notas no ContactInfoPanel com editor de mention.

## Arquivos permitidos
- `packages/db/src/schema/conversation_notes.ts`, `packages/db/src/schema/index.ts`, `packages/db/drizzle/**`, `apps/api/src/routes/conversations/notes.ts`, `apps/web/features/conversations/components/Notes/**`

## Definition of Done
- [ ] Nota com `@member` gera notificação (inbox + socket member:{id}).
- [ ] RLS na tabela; typecheck + lint + migrate + build.

## UX considerations
- Aplica UX §2.12 (notificação por evento relevante, agrupada — sem spam).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db migrate
pnpm --filter @hm/web build
```
