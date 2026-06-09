---
id: F0-S03
title: Schema Drizzle base + migrations + seed (workspaces, members, plans, subscriptions, audit_logs)
phase: F0
status: available
priority: critical
estimated_size: M
depends_on: [F0-S01]
---

# F0-S03 — Schema Drizzle base + migrations + seed

> **source_docs:** `docs/DATA_MODEL.md` §3 (workspaces/members/api_keys), §13 (plans/subscriptions), §14 (audit_logs); `docs/ARCHITECTURE.md` ADR-002/003, §"Pool: postgres driver"
> **blocks:** F0-S04, F0-S05, F0-S06

## Objetivo

Materializar `@hm/db` com Drizzle: schema das tabelas-base da plataforma, conexão (driver `postgres`/postgres.js), drizzle-kit config, migrations versionadas e seed (1 workspace dev + 1 owner + planos).

## Escopo (faz)

- `packages/db/package.json` — deps `drizzle-orm`, `postgres`; dev `drizzle-kit`, `tsx`. Scripts `generate`/`migrate`/`seed`.
- `packages/db/drizzle.config.ts` — dialect postgres, schema dir, out `./drizzle`, `DATABASE_URL`.
- `packages/db/src/client.ts` — `postgres()` pool + `drizzle()` instance.
- `packages/db/src/schema/` — `workspaces.ts`, `members.ts`, `plans.ts`, `subscriptions.ts`, `audit_logs.ts` (+ `api_keys.ts`) exatamente como DATA_MODEL (enums via CHECK/text, índices, FKs, jsonb defaults). Barrel `schema/index.ts`.
- `packages/db/src/repos/` — repositório base tipado (`ScopedRepository`) + repo de workspaces/members mínimo.
- `packages/db/drizzle/**` — migration gerada (`drizzle-kit generate`).
- `packages/db/src/seed.ts` — cria planos (free/starter/pro/business), 1 workspace dev, 1 member OWNER, subscription trial.
- `packages/db/src/index.ts` — exporta client, schema, repos.

## Fora de escopo

- RLS policies (F0-S04). Auth/Supabase (F0-S05). Tabelas de outros domínios (F1+).

## Arquivos permitidos

- `packages/db/**`

## Arquivos proibidos

- `apps/**`, outros `packages/**`.

## Contratos de saída

- `import { db, schema, workspacesRepo } from '@hm/db'`.
- Migration aplicável: `pnpm --filter @hm/db migrate`. Seed: `pnpm --filter @hm/db seed`.

## Definition of Done

- [ ] `drizzle-kit generate` produz migration sem erro.
- [ ] `pnpm --filter @hm/db migrate` aplica no Postgres dev (extensão pgvector já presente; habilitar `citext` p/ members.email).
- [ ] `pnpm --filter @hm/db seed` cria 4 planos + 1 workspace + 1 owner + subscription trial (idempotente).
- [ ] Enums/CHECKs e índices conforme DATA_MODEL; `role` = OWNER/ADMIN/SUPERVISOR/AGENT/READONLY.
- [ ] `pnpm typecheck` e `pnpm lint` limpos.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/db migrate
pnpm --filter @hm/db seed
```

## Notas

- Precisa de `.env` com `DATABASE_URL=postgres://hm:hm@localhost:5432/highermind` (gitignored). Postgres já no ar (F0-S02).
- `citext` p/ email: `CREATE EXTENSION IF NOT EXISTS citext` na 1ª migration.
- O `role` do DB diverge do `@hm/shared` skeleton (owner/admin/manager/agent/viewer) — a fonte da verdade é o DATA_MODEL; o `@hm/shared` é reconciliado em F0-S06.
