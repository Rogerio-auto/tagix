---
id: F71-S14
title: Convite não reativa bloqueado, logger com redact e papéis do Postgres
phase: F71
status: available
priority: medium
estimated_size: L
depends_on: [F71-S10]
blocks: [F71-S13, F71-S18]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/features/PERMISSIONS.md
  - docs/runbooks/database-login-roles.md
---
# F71-S14 — Packages: bloqueado, redact, GRANTs e regra de assinatura

## Objetivo

Fechar os achados de camada baixa da F71: bloqueado não volta por convite, segredos não aparecem em log, os papéis reais do Postgres têm os GRANTs certos e a regra de assinatura inativa existe uma vez só.

## Contexto

Auditoria F71: F-11 (`upsertMemberFromInvite` reativa membro `blocked`), redact incompleto no logger, F-17 (papéis `hm_api_system`/`hm_api_login` sem GRANT em `member_invites` e leitura por `auth_user_id`), regra `INACTIVE_SUBSCRIPTION_STATUSES`/`isSubscriptionInactive` duplicada (follow-up da S06) e `departmentId` do convite validado mas nunca aplicado ao membro (PERMISSIONS §7).

## Escopo (faz)

- `packages/db/src/repos/member-invites.ts`: `upsertMemberFromInvite` lança `InviteAcceptConflictError` se o membro existente está `blocked`; teste de corrida (aceites concorrentes e aceite concorrente com bloqueio).
- Aplicar `departmentId` do convite ao membro criado/reativado (conferir PERMISSIONS §7; departamento removido → aceita sem departamento e registra).
- `packages/logger/src/index.ts` `REDACT_PATHS`: `tokenHash`, `token_hash`, `emailProof`, `accessToken`, `access_token`, `refreshToken` (também aninhados); teste do redact.
- Migration versionada com GRANTs de `member_invites` e das leituras por `auth_user_id` para `hm_api_system`/`hm_api_login` conforme `docs/runbooks/database-login-roles.md`; teste de integração conectando **com o papel real** (não superusuário).
- Subir `INACTIVE_SUBSCRIPTION_STATUSES`/`isSubscriptionInactive` para `@hm/shared`; refatorar `subscription-guard.ts` (API) e `subscription-gate.ts` (workers) para importar, comportamento idêntico.

## Fora de escopo

- Rota de aceite inline (S13), Origin do socket e rate limit (S18).

### files_allowed

- `packages/db/src/repos/member-invites.ts`, `packages/db/src/repos/memberships.ts`, testes ao lado
- `packages/db/drizzle/**` e `packages/db/src/schema/**` (só a migration de GRANT, sem mudar colunas)
- `packages/logger/src/**`
- `packages/shared/src/**` (módulo de assinatura novo + export)
- `apps/api/src/middlewares/subscription-guard.ts` e teste (só trocar import)
- `apps/workers/src/lib/subscription-gate.ts` e teste (só trocar import)
- `docs/runbooks/database-login-roles.md`

### files_forbidden

- `apps/api/src/auth/**`, `apps/api/src/middlewares/auth.ts`, `apps/web/**`

## Definition of Done

- [ ] teste: aceite de convite para membro `blocked` → `InviteAcceptConflictError`, nada muda
- [ ] teste de corrida: aceites concorrentes resultam em uma membership
- [ ] teste: `departmentId` do convite é aplicado ao membro; departamento inexistente não quebra
- [ ] teste: log com `tokenHash`/`emailProof`/`accessToken`/`token_hash` sai `[Redacted]`
- [ ] teste de integração com o papel real: `hm_api_login` lê o necessário de `member_invites` e membros por `auth_user_id` e é negado no resto
- [ ] regra de assinatura só existe em `@hm/shared`; `grep` não acha cópias; testes da S06 verdes

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/logger typecheck
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
node --env-file=.env packages/db/node_modules/vitest/vitest.mjs run --root packages/db src/repos --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/middlewares --maxWorkers=1
```

## Notas

- Agentes: `db-engineer` (repo, migration, GRANTs) e `backend-engineer` (logger, shared, refator dos consumidores).
- Migration em produção exige aviso ao Rogério (papéis do Postgres).
