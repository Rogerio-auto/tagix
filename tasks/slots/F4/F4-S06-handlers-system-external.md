---
id: F4-S06
title: Handlers de sistema/externos — ai_action + change_status + http_request + external_notify
phase: F4
status: in-progress
priority: high
estimated_size: M
depends_on: [F4-S02]
agent_id: backend-engineer
claimed_at: 2026-06-10T20:26:44Z

---
# F4-S06 — Handlers de sistema e externos

> **source_docs:** `docs/features/FLOW_BUILDER.md` §4.1, §4.3 (external_notify biestável), §6 (retry); `docs/ROADMAP.md` F4-S07, F4-S08
> **blocks:** —

## Objetivo
Implementar (substituindo stubs de F4-S02): `ai_action` (ACTIVATE/DEACTIVATE/TRANSFER → update `conversations.ai_mode`+`agent_id`), `change_status` (update `conversations.status`), `http_request` (GET/POST/… com retry policy + timeout 30s, guarda response em `variables`), `external_notify` (biestável §4.3: envia pra outra conversa por `target` RESPONSIBLE/ENTITY_CUSTOMER/FLOW_CONTACT/CUSTOM).

## Escopo (faz)
- `handlers/ai_action.handler.ts`, `handlers/change_status.handler.ts`, `handlers/http_request.handler.ts`, `handlers/external_notify.handler.ts`.
- `http_request`: retry exponencial (§6.1, `node.data.retryPolicy`), timeout 30s, edges `success`/`error`, response em `variables.webhook_response.*`.
- `external_notify`: resolução de phone por `target`; cria/acha contact+conversation no `channelId`; modo biestável (edges `response`/`timeout`) quando aguarda.

## Fora de escopo
- `move_stage`/`add_tag`/`remove_tag` (stub-guard permanece em F4-S02 até F5), outros handlers (F4-S04/05).

## Arquivos permitidos
- `packages/flow-engine/src/handlers/ai_action.handler.ts`
- `packages/flow-engine/src/handlers/change_status.handler.ts`
- `packages/flow-engine/src/handlers/http_request.handler.ts`
- `packages/flow-engine/src/handlers/external_notify.handler.ts`

## Arquivos proibidos
- `packages/flow-engine/src/registry.ts`, `index.ts`, `types.ts`, `context.ts`, `dispatcher.ts` (donos: F4-S02)

## Definition of Done
- [ ] `ai_action`/`change_status` atualizam `conversations` pelo ctx (RLS) e logam; `http_request` aplica retry/backoff + timeout e popula `webhook_response`.
- [ ] `external_notify` resolve target → outbound em outra conversa; modo biestável testado (response/timeout).
- [ ] Testes unitários por handler (ctx/http mockados); `pnpm --filter @hm/flow-engine test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/flow-engine test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Paralelo a F4-S04/S05. `http_request` é o handler de maior risco de travar worker — timeout duro 30s é obrigatório (§12).
