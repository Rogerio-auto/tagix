---
id: F9-S04
title: Management CRUD — API keys (create show-once/list/revoke) + webhooks subscriptions
phase: F9
status: blocked
priority: high
estimated_size: M
depends_on: [F9-S01]
---
# F9-S04 — Management CRUD (keys + webhooks)

> **source_docs:** `docs/DATA_MODEL.md` §3.3, §14.3; `docs/features/PERMISSIONS.md` §2; `docs/ROADMAP.md` F9-S04 (parte subscription)
> **blocks:** F9-S06

## Objetivo
API de gestão (session-authed, não api-key) consumida pela página Settings→Dev: CRUD de `api_keys` (criar → retorna o token claro **uma única vez**; listar com prefix/last_used; revogar) e CRUD de `outbound_webhooks` (criar/editar/deletar; `secret_enc` cifrado; testar entrega).

## Escopo (faz)
- `apps/api/src/routes/dev/api-keys.ts`: `POST /api/api-keys` (gera via service de F9-S02, retorna claro 1x), `GET` (lista, sem o hash), `DELETE/:id` (revoga → `revoked_at`).
- `apps/api/src/routes/dev/webhooks.ts`: CRUD de `outbound_webhooks` (cifra o secret com AES-256-GCM), `POST /:id/test` (dispara um delivery de teste), `GET /:id/deliveries` (log).
- Permissões `apikey.manage`/`webhook.manage` (ADMINS) em `permissions.ts` se faltarem.

## Fora de escopo
- Middleware de auth da API pública (F9-S02), dispatch real (F9-S05), UI (F9-S06).

## Arquivos permitidos
- `apps/api/src/routes/dev/api-keys.ts`
- `apps/api/src/routes/dev/webhooks.ts`
- `apps/api/src/routes/dev/index.ts`
- `packages/shared/src/permissions.ts`

## Permission scope
- Tudo gated por `apikey.manage`/`webhook.manage` (ADMINS — chaves dão acesso à API; é sensível). Cite `permissions.ts`.

## Definition of Done
- [ ] Criar chave retorna o token claro só na criação; listar nunca expõe hash; revogar invalida; webhooks CRUD cifra secret e testa entrega; delivery log lista.
- [ ] `pnpm --filter @hm/api test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Reusa `generateApiKey`/`hashApiKey` (F9-S02) e a cripto AES-256-GCM (F1-S01). Router montado em app.ts pelo orchestrator.
