---
id: F1-S24
title: API send message — POST /api/conversations/:id/messages → enqueue outbound
phase: F1
status: available
priority: critical
estimated_size: M
depends_on: [F1-S05, F1-S07, F1-S12]
---

# F1-S24 — API send message (composer → outbound queue)

> **source_docs:** `docs/features/LIVECHAT.md` §3.1; `apps/workers/src/outbound/job.ts` (OutboundJob)
> **gap:** decomposição original não cobriu a rota de envio (compositor S16 faz POST a um endpoint inexistente → 404→rollback).

## Objetivo
Endpoint `POST /api/conversations/:id/messages`: valida (Zod), persiste a mensagem outbound (`view_status: pending`) via `@hm/db` + RLS, publica um `OutboundJob` em `hm.q.outbound` (shape exato de `parseOutboundJob`), e — quando `messageTag != null` — grava `audit_logs`. Retorna `{ message }` (a UI já faz optimistic; aqui vira real).

## Escopo (faz)
- `apps/api/src/routes/conversations/messages.ts` — `createMessagesRouter()`: POST cria a mensagem (text/media/template/interactive), resolve canal da conversa, publica `OutboundJob` (envelope `outbound.request`, RK `hm.q.outbound.*`), grava audit em `messageTag != null`. Zod no body (inclui `messageTag?`), `req.scoped!` RLS, `req.params['id']` narrowed.
- `apps/api/src/mq/outbound-publisher.ts` — publisher lazy (conecta via `@hm/shared/mq`, mesmo padrão de `routes/webhooks/publisher.ts`).

## Arquivos permitidos
- `apps/api/src/routes/conversations/messages.ts`, `apps/api/src/mq/outbound-publisher.ts`

## Definition of Done
- [ ] POST persiste mensagem `pending` e retorna `{ message }`; publica `OutboundJob` compatível com `apps/workers/src/outbound/job.ts`.
- [ ] `messageTag != null` → grava `audit_logs` (`schema.auditLogs`, RLS).
- [ ] Zod valida o body; RLS via `req.scoped`; typecheck + lint.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```
