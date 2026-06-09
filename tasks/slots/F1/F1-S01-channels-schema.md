---
id: F1-S01
title: Schema channels + channel_secrets + crypto AES-256-GCM (+ colunas IG)
phase: F1
status: in-progress
priority: critical
estimated_size: M
depends_on: [F0-S03, F0-S04]
agent_id: backend-engineer
claimed_at: 2026-06-09T22:43:58Z

---
# F1-S01 — Schema channels + secrets + crypto

> **source_docs:** `docs/DATA_MODEL.md` §6.1 (channels), §6.2 (channel_secrets); `docs/features/LIVECHAT.md` §2; `docs/features/INSTAGRAM.md`
> **blocks:** F1-S02, F1-S04, F1-S07, F1-S08, F1-S18

## Objetivo

Modelar canais de mensageria e seus segredos cifrados, com `provider` (`meta_whatsapp` | `meta_instagram` | `waha`) e colunas IG (ig_user_id, fb_page_id, ig_username) prontas desde o MVP.

## Escopo (faz)

- `packages/db/src/schema/channels.ts` — `channels` (provider, status, credenciais públicas, colunas IG) + `channel_secrets` (valores cifrados) conforme DATA_MODEL §6.1/6.2. RLS no mesmo PR (workspace_id).
- `packages/db/src/crypto.ts` — AES-256-GCM com versionamento de key (`ENCRYPTION_KEY`/`ENCRYPTION_KEY_VERSION`): `encryptSecret`/`decryptSecret`.
- Barrel + migration drizzle + policy RLS (migration custom).

## Arquivos permitidos
- `packages/db/src/schema/channels.ts`, `packages/db/src/crypto.ts`, `packages/db/src/schema/index.ts`, `packages/db/drizzle/**`, `packages/db/src/index.ts`

## Definition of Done
- [ ] Tabelas criadas com enum `provider` + colunas IG; RLS habilitada e testada.
- [ ] crypto AES-256-GCM round-trip testado (vitest); key versionada.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm --filter @hm/db migrate`, `pnpm --filter @hm/db test` limpos.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/db migrate
pnpm --filter @hm/db test
```

## Notas
Segredos nunca em texto puro no banco. `channel_secrets` guarda só ciphertext + iv + tag + key_version.
