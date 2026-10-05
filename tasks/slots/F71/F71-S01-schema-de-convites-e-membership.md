---
id: F71-S01
title: Schema de convites, membership por pessoa e trial de 15 dias no provisionador
phase: F71
status: available
priority: critical
estimated_size: M
depends_on: []
blocks: [F71-S03, F71-S05, F71-S06]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/features/PERMISSIONS.md
---
# F71-S01 — Schema de convites, membership por pessoa e trial de 15 dias no provisionador

## Objetivo

O banco passa a representar convite de verdade (tabela própria, token só como hash), resolve membership por pessoa (`auth_user_id`) e não por email, e o provisionador cria empresa com trial de 15 dias.

## Contexto

Hoje o "convite" é uma linha em `members` com `authUserId` aleatório, e `membersRepo.findByEmail` não filtra por empresa. Tudo o que vem depois na F71 (sessão multi-empresa, API de convite, trial) consome este slot. Spec: `docs/features/CONTAS_E_CONVITES.md` §4.

## Escopo (faz)

- Tabela `member_invites` conforme a spec §4, com:
  - RLS por `workspace_id` (mesmo padrão das outras tabelas tenant), e teste em `rls.test.ts`;
  - `check (role <> 'OWNER')`;
  - índice único parcial de convite pendente por `(workspace_id, email)` (`accepted_at is null and revoked_at is null`);
  - `token_hash` único.
- `members`: `last_active_at`, `terms_accepted_at`, `terms_version`.
- Migração `0094_f71_member_invites.sql` (próximo número livre — conferir em `drizzle/meta/_journal.json`):
  - move `members` com `status='invited' and invited_by is not null` para `member_invites` pendentes (`token_hash` = hash de um valor aleatório inutilizável; `expires_at = now() + 7 days`; o admin reenvia pela UI) e apaga essas linhas de `members`;
  - backfill: `workspaces`/`subscriptions` com status `trial` e `trial_ends_at is null` → `now() + interval '15 days'`.
- Repos (`packages/db/src/repos/`):
  - `invitesRepo` (criar, achar por hash para aceite — caminho privilegiado, fora de RLS, porque o aceite acontece antes de haver workspace no escopo —, listar pendentes por workspace, listar pendentes por email, revogar, marcar aceito, registrar reenvio);
  - `membershipsRepo`: `listActiveByAuthUser(authUserId)`, `findActive(authUserId, workspaceId)`, `touchLastActive(memberId)`;
  - `membersRepo.findByEmail` fica marcado `@deprecated` (consumidores migram na S03); não remover aqui.
- Provisionador (`provisionWorkspaceWithOwner`):
  - `trial_ends_at = now + 15 dias` em `workspaces` e `subscriptions`;
  - idempotência deixa de ser "email existe em qualquer empresa": vira "este `authUserId` já é OWNER de alguma empresa" → `created:false`. Uma pessoa convidada em outra empresa que faz signup ganha a própria empresa;
  - o member OWNER continua nascendo `invited` (pré-verify) e `isPlatformAdmin:false`;
  - aceita `termsAcceptedAt`/`termsVersion` opcionais e grava no OWNER (consumido pela S04).
- Testes: dupla aplicação do provisionador, convidado-em-outra-empresa faz signup, unicidade do convite pendente, RLS de `member_invites`, `listActiveByAuthUser` ignora `inactive`/`blocked`/`invited`.

## Fora de escopo

- Rotas e sessão (S03/S05). Envio de email (S02). Expiração automática do trial (S06).

### files_allowed

- `packages/db/src/schema/**`
- `packages/db/drizzle/**`
- `packages/db/src/repos/**`
- `packages/db/src/provisioning/**`
- `packages/db/src/index.ts`
- `packages/db/src/rls.test.ts`
- `packages/db/src/**/*.test.ts`

### files_forbidden

- `apps/**`

## Definition of Done

- [ ] `member_invites` criada com RLS + teste de isolamento entre dois workspaces
- [ ] migração idempotente; convites antigos migrados; backfill do trial
- [ ] repos novos exportados por `@hm/db` e testados
- [ ] provisionador grava `trial_ends_at` (15 dias) e tem a nova regra de idempotência, com teste
- [ ] typecheck do `@hm/db` e dos consumidores (`@hm/api`, `@hm/workers`) verde
- [ ] nota no slot com a **lista de empresas que o backfill do trial atinge** no banco de dev, e a query para o Rogério rodar em produção antes do deploy

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
node --env-file=.env packages/db/node_modules/vitest/vitest.mjs run --root packages/db src/rls.test.ts src/provisioning --maxWorkers=1
```

## Notas

- Schema é sequencial: nenhum outro slot da F71 toca `packages/db/**`. Se S03–S06 precisarem de algo do banco, volta para cá ou abre slot próprio.
- Agente: `db-engineer`.
