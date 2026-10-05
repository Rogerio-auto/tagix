---
id: F71-S03
title: Sessão por pessoa e empresa ativa — troca de empresa, login escolhe a última usada
phase: F71
status: in-progress
priority: critical
estimated_size: M
depends_on: [F71-S01, F71-S02]
blocks: [F71-S04, F71-S05, F71-S06, F71-S08]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
agent_id: backend-engineer
claimed_at: 2026-10-05T16:05:37Z

---
# F71-S03 — Sessão por pessoa e empresa ativa

## Objetivo

Uma pessoa com membership ativa em várias empresas entra na última que usou e troca de empresa sem sair. A sessão é resolvida por `auth_user_id` e por empresa ativa, nunca por email.

## Contexto

C1 e A5 da spec. Login, `/api/me`, `requireAuth` e o handshake do socket usam `membersRepo.findByEmail`, que devolve uma linha qualquer. Spec §3.2 e §5.

## Escopo (faz)

- `session.ts`: `resolveSessionStatus(token, preferredWorkspaceId?)`:
  - identidade → `membershipsRepo.listActiveByAuthUser`;
  - empresa preferida, se for membership ativa; senão a de `last_active_at` mais recente;
  - nenhuma → `invalid`.
- Cookie `hm_workspace`: httpOnly, `SameSite=Lax`, `Secure` em prod, 30 dias. Só aceita UUID e é sempre revalidado; cookie de empresa sem membership é ignorado, não dá erro.
- Login (`routes.ts`):
  - usa membership por `authUserId`;
  - seta `hm_workspace` e atualiza `last_active_at`;
  - não emite cookie sem membership ativa (mantém F70-S28).
- `GET /api/me` devolve `memberships[]`.
- `POST /api/me/workspace { workspaceId }`:
  - valida membership ativa, seta o cookie e grava a auditoria `workspace.switched`;
  - é rejeitado sob impersonation (view-as).
- `requireAuth` e o handshake do socket passam a ler `hm_workspace`. As rooms do socket já são `ws:<id>` e seguem a empresa ativa.
- `verifyHandler` (`reset.ts`): promove para `active` **só** a linha `invited` do `authUserId` confirmado, nunca por email e nunca linhas `inactive`/`blocked` (A5).
- `PATCH /api/members/me/password` usa `updatePassword` do provider (fim do 501).
- `mock-provider.ts` deixa de usar `findByEmail`, se ainda usar; nenhum consumidor de `findByEmail` sobra em `apps/api`.
- Logout limpa `hm_workspace`.

## Fora de escopo

- UI do seletor (S08). Signup/resend (S04). Convites (S05).

### files_allowed

- `apps/api/src/auth/session.ts`, `apps/api/src/auth/session.test.ts`
- `apps/api/src/auth/routes.ts`, `apps/api/src/auth/routes.test.ts`
- `apps/api/src/auth/reset.ts`
- `apps/api/src/auth/index.ts`
- `apps/api/src/auth/mock-provider.ts`
- `apps/api/src/auth/flow.integration.test.ts`
- `apps/api/src/middlewares/auth.ts`
- `apps/api/src/middlewares/impersonation.ts`, `apps/api/src/middlewares/impersonation.test.ts`
- `apps/api/src/socket/**`
- `apps/api/src/routes/members/**`
- `apps/api/src/types/**` (augment do `req.auth`, se necessário)

### files_forbidden

- `packages/db/**` (S01), `apps/api/src/auth/signup.ts` (S04)

## Definition of Done

- [ ] teste: pessoa em 2 empresas → login cai na última usada; troca → requests seguintes na outra
- [ ] teste: `hm_workspace` de empresa sem membership → ignorado, cai na padrão
- [ ] teste: membership `inactive` numa empresa e `active` noutra → nunca resolve a inativa
- [ ] teste: verify não reativa member removido (A5)
- [ ] teste: troca de empresa sob view-as é rejeitada
- [ ] socket entra na room da empresa ativa (teste do handshake)
- [ ] troca de senha funciona com o provider Supabase (teste com provider mockado)
- [ ] zero uso de `membersRepo.findByEmail` em `apps/api/src` (grep no DoD)

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api lint
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/auth src/middlewares src/socket src/routes/members --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`.
- O middleware do web (F70-S28) consulta `/api/me` repassando os cookies; conferir que `hm_workspace` segue junto.
