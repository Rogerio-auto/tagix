---
id: F9-S02
title: API key auth middleware + rate limit por chave (Redis)
phase: F9
status: done
priority: high
estimated_size: M
depends_on: [F9-S01]
agent_id: backend-engineer
claimed_at: 2026-06-11T21:32:13Z
completed_at: 2026-06-11T21:37:21Z

---
# F9-S02 — API key auth + rate limit

> **source_docs:** `docs/DATA_MODEL.md` §3.3; `docs/ARCHITECTURE.md` (API pública); `docs/ROADMAP.md` F9-S01
> **blocks:** F9-S03

## Objetivo
Gate da API pública: middleware `requireApiKey` que extrai o token (`Authorization: Bearer hm_...`), faz SHA-256 → lookup em `api_keys` (ativo/não-expirado/não-revogado), injeta `req.apiAuth { workspaceId, scopes }`, atualiza `last_used_at`, e aplica **rate limit por chave** (`rate_limit_per_minute`) via Redis (sliding window). Helper `requireScope(scope)` para autorização fina.

## Escopo (faz)
- `apps/api/src/middlewares/api-key.ts`: `requireApiKey` + `requireScope` + sliding-window rate-limit no Redis (`hm:ratelimit:apikey:<id>`), headers `X-RateLimit-*`, 401/403/429 claros (JSON com ref).
- Geração/hash de chave (`hashApiKey`, `generateApiKey` com prefixo `hm_` + key_prefix display) em `apps/api/src/services/api-keys.ts` (consumido por F9-S04).

## Fora de escopo
- CRUD de chaves (F9-S04), endpoints /v1 (F9-S03), schema (F9-S01).

## Arquivos permitidos
- `apps/api/src/middlewares/api-key.ts`
- `apps/api/src/services/api-keys.ts`

## Contratos de saída
- `requireApiKey` injeta `req.apiAuth: { workspaceId, scopes: string[], keyId }` + roda sob RLS (`withRLS` equivalente por workspace). `requireScope('read:conversations')` → 403 se ausente.

## Definition of Done
- [ ] Token válido autentica + injeta workspace/scopes + atualiza last_used; inválido/expirado/revogado → 401; scope ausente → 403; excedeu rate → 429 com headers.
- [ ] `pnpm --filter @hm/api test` (redis/db mockados) + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Reusa o cliente Redis existente (mesmo de locks/cache). A chave clara só existe na criação (F9-S04) — aqui só o hash é comparado.
