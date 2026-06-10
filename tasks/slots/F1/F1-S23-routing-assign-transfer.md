---
id: F1-S23
title: Auto-assign + manual transfer + routing_history
phase: F1
status: review
priority: medium
estimated_size: M
depends_on: [F1-S05, F1-S12]
agent_id: backend-engineer
claimed_at: 2026-06-10T01:02:43Z
completed_at: 2026-06-10T01:02:43Z

---
# F1-S23 — Routing (assign / transfer / history)

> **source_docs:** `docs/features/LIVECHAT.md` §7; `docs/features/PERMISSIONS.md` §2.1; `docs/DATA_MODEL.md` (routing_history)
> **blocks:** —

## Objetivo
Atribuição automática de conversas + transferência manual entre members/departamentos, com histórico de routing auditável.

## Escopo (faz)
- `packages/db/src/schema/routing_history.ts` (+ RLS, migration).
- `apps/api/src/routes/conversations/routing.ts` — assign/transfer (guard `conversation.assign`), regra de auto-assign (round-robin/dept) + grava routing_history + emit `conversation:assigned`/`conversation:routing_changed`.
- Frontend: dropdown de transfer no header da conversa + histórico no ContactInfoPanel.

## Arquivos permitidos
- `packages/db/src/schema/routing_history.ts`, `packages/db/src/schema/index.ts`, `packages/db/drizzle/**`, `apps/api/src/routes/conversations/routing.ts`, `apps/web/features/conversations/components/RoutingMenu/**`

## Definition of Done
- [ ] Auto-assign + transfer manual funcionam; routing_history registra; eventos socket emitidos.
- [ ] requireRole; RLS; typecheck + lint + migrate + build.

## Permission scope
- `conversation.assign` = OWNER/ADMIN/SUPERVISOR (AGENT só "pega" a si; READONLY ❌). PERMISSIONS.md §2.1.

## UX considerations
- Aplica UX §3.9 (timeline de routing no painel) e §2.1 (ação no corpo, não ícone obscuro).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db migrate
pnpm --filter @hm/web build
```
