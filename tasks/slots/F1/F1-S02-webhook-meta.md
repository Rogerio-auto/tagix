---
id: F1-S02
title: Webhook Meta unificado + signature verify + dedup (webhook_events)
phase: F1
status: review
priority: critical
estimated_size: M
depends_on: [F0-S06, F1-S01]
agent_id: backend-engineer
claimed_at: 2026-06-10T00:29:46Z
completed_at: 2026-06-10T00:29:53Z

---
# F1-S02 — Webhook Meta unificado

> **source_docs:** `docs/features/LIVECHAT.md` §2.4, §1; `docs/DATA_MODEL.md` (webhook_events)
> **blocks:** F1-S04

## Objetivo
Endpoint único `/webhooks/meta` (WhatsApp + Instagram no mesmo Meta App) com verificação de assinatura HMAC (app_secret), GET de verify-token, despacho por `body.object`, dedup via `webhook_events`, e publish em `hm.channels`. Endpoint `/webhooks/waha` próprio.

## Escopo (faz)
- `packages/channels/src/shared/hmac.ts` — `verifyMetaSignature(rawBody, signature, appSecret)`.
- `packages/db/src/schema/webhook_events.ts` — dedup (provider, external_event_id, raw_payload, received_at; retenção 30d).
- `apps/api/src/routes/webhooks/meta.ts` + `waha.ts` — GET verify + POST (verify sig → dedup → publish envelope `inbound.message` com provider) — responde < 5s (200).
- Raw body middleware p/ HMAC (não pode usar body já parseado).

## Arquivos permitidos
- `apps/api/src/routes/webhooks/**`, `packages/channels/src/shared/hmac.ts`, `packages/db/src/schema/webhook_events.ts`, `packages/db/src/schema/index.ts`, `packages/db/drizzle/**`

## Definition of Done
- [ ] GET verify retorna challenge; POST com assinatura inválida → 403 (0% em prod).
- [ ] Dedup: evento repetido não re-publica.
- [ ] Publica envelope com `provider` correto por `body.object`.
- [ ] typecheck + lint; teste de assinatura HMAC (válida/inválida).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
Rate limit no endpoint público. `webhook_events.raw_payload` mantido 30d para hotfix de parser.
