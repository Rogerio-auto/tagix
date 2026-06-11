---
id: F9-S01
title: Schema outbound_webhooks + outbound_webhook_deliveries (+ verificar api_keys) + RLS
phase: F9
status: done
priority: critical
estimated_size: S
depends_on: []
agent_id: backend-engineer
claimed_at: 2026-06-11T21:28:24Z
completed_at: 2026-06-11T21:31:04Z

---
# F9-S01 — Schema webhooks outbound

> **source_docs:** `docs/DATA_MODEL.md` §3.3 (`api_keys`), §14.3 (`outbound_webhooks`/`deliveries`); `docs/ROADMAP.md` F9-S04 (parte schema)
> **blocks:** F9-S02, F9-S04, F9-S05

## Objetivo
Criar `outbound_webhooks` (assinaturas do cliente, `secret_enc` AES-256-GCM para HMAC) e `outbound_webhook_deliveries` (fila durável com retry) conforme §14.3, com RLS. Verificar que `api_keys` (§3.3 — já existe no schema desde F0) tem `scopes`/`rate_limit_per_minute`/`key_hash`/`key_prefix`/`last_used_at`/`expires_at`/`revoked_at`; **estender** se faltar coluna.

## Escopo (faz)
- `packages/db/src/schema/webhooks.ts`: `outbound_webhooks` + `outbound_webhook_deliveries` (CHECK status, índice parcial `next_attempt_at WHERE status IN ('pending','retrying')`).
- Conferir/estender `api_keys` (em `schema/index.ts`) para casar §3.3 — adicionar colunas ausentes via migration (sem quebrar o que existe).
- Barrel `index.ts` (+ `RLS_TABLES`); migration de tabela + RLS por `app.workspace_id`.

## Fora de escopo
- Auth/rate-limit (F9-S02), CRUD (F9-S04), worker (F9-S05).

## Arquivos permitidos
- `packages/db/src/schema/webhooks.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`

## Definition of Done
- [ ] `outbound_webhooks` + `outbound_webhook_deliveries` criados (§14.3) com índice de pendentes; `api_keys` confere com §3.3 (estendido se faltava).
- [ ] RLS criada e testada nas tabelas com `workspace_id`.
- [ ] `pnpm --filter @hm/db test` + typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db test
```

## Notas
- Especialista sugerido: **db-engineer**.
- `secret_enc` reusa a cripto AES-256-GCM de F1-S01 (mesma usada em `channel_secrets`).
