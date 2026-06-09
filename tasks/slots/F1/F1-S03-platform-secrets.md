---
id: F1-S03
title: Schema platform_secrets + carregamento boot-time
phase: F1
status: review
priority: high
estimated_size: S
depends_on: [F0-S03]
agent_id: backend-engineer
claimed_at: 2026-06-09T23:49:28Z
completed_at: 2026-06-09T23:54:52Z

---
# F1-S03 — platform_secrets + boot load

> **source_docs:** `docs/features/LIVECHAT.md` §2.4; `docs/DATA_MODEL.md` (platform_secrets)
> **blocks:** F1-S02, F1-S19

## Objetivo
Segredos de plataforma (meta_app_secret, meta_app_id, meta_webhook_verify_token, encryption keys) em tabela cifrada, carregados em memória no boot da API.

## Escopo (faz)
- `packages/db/src/schema/platform_secrets.ts` — tabela (key, value cifrado, key_version). SEM workspace_id (platform-level; sem RLS de tenant).
- `apps/api/src/secrets/index.ts` — `loadPlatformSecrets()` no boot → `platformSecrets.get(key)`.

## Arquivos permitidos
- `packages/db/src/schema/platform_secrets.ts`, `packages/db/src/schema/index.ts`, `packages/db/drizzle/**`, `apps/api/src/secrets/**`

## Definition of Done
- [ ] Tabela + migration; valores cifrados (reusa crypto de F1-S01 ou env fallback no MVP).
- [ ] `platformSecrets.get()` disponível após boot; falta de secret obrigatório = fail-fast.
- [ ] typecheck + lint.

## Validação
```bash
pnpm typecheck
pnpm lint
```

## Notas
No MVP os secrets podem vir do `.env` (META_APP_SECRET etc.) com a tabela como destino futuro do painel super-admin.
