---
id: F0-S15
title: Storage — LocalDriver (dev) + R2Driver (S3) + signed URL
phase: F0
status: review
priority: medium
estimated_size: S
depends_on: [F0-S01]
agent_id: backend-engineer
claimed_at: 2026-06-09T22:08:17Z
completed_at: 2026-06-09T22:10:24Z

---
# F0-S15 — Storage drivers (Local + R2)

> **source_docs:** `docs/ARCHITECTURE.md` §Storage; `docs/INFRASTRUCTURE.md` §R2

## Objetivo

Implementar `IStorageDriver` (já definido em `@hm/storage`) com `LocalDriver` (dev) e `R2Driver` (S3-compatível) + URLs assinadas.

## Escopo (faz)

- `packages/storage` — dep `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. `LocalDriver` (fs em `LOCAL_STORAGE_PATH`, signed URL = rota local assinada por HMAC ou path-token simples). `R2Driver` (S3 client com endpoint R2). Factory `createStorage(env)` escolhe por `STORAGE_DRIVER`.

## Arquivos permitidos

- `packages/storage/**`

## Definition of Done

- [ ] `LocalDriver.put/getSignedUrl/delete` funcionam em fs.
- [ ] `R2Driver` implementa a interface (config via env R2_*).
- [ ] Factory escolhe driver por env; default local em dev.
- [ ] `pnpm typecheck`, `pnpm lint` limpos.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/storage test
```

## Notas

Independe do schema — paralelizável com F0-S03/S08.
