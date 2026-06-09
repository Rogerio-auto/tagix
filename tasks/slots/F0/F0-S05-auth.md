---
id: F0-S05
title: Auth — IAuthProvider + Supabase adapter + login/logout API + cookie de sessão
phase: F0
status: review
priority: critical
estimated_size: M
depends_on: [F0-S03]
agent_id: backend-engineer
claimed_at: 2026-06-09T17:11:00Z
completed_at: 2026-06-09T17:14:04Z

---
# F0-S05 — Auth (IAuthProvider + Supabase adapter)

> **source_docs:** `docs/ARCHITECTURE.md` (ADR auth Supabase atrás de interface); `docs/INDEX.md` (Auth ADR); `docs/features/PERMISSIONS.md`
> **blocks:** F0-S06 (requireAuth), wiring do login web (F0-S13)

## Objetivo

Abstrair autenticação atrás de `IAuthProvider`, com adapter Supabase (atrás de flag/mock quando sem credenciais), endpoints de login/logout/me e cookie de sessão httpOnly.

## Escopo (faz)

- `packages/shared/src/auth/IAuthProvider.ts` — interface (`signIn`, `verifyToken`, `signOut`) + tipos de sessão.
- Adapter Supabase em `apps/api/src/auth/supabase-provider.ts` (usa `@supabase/supabase-js`) **e** `mock-provider.ts` (sem credenciais: aceita seed owner). Seleção por env (`SUPABASE_URL` presente → real; senão mock).
- Resolução `auth_user_id → member` (via `@hm/db`), retornando member + workspace + role.
- Cookie de sessão httpOnly/SameSite; helpers set/clear.

## Fora de escopo

- Cadastro/signup, MFA, social login. Express server em si (F0-S06) — aqui só o módulo de auth + as rotas montáveis.

## Arquivos permitidos

- `apps/api/src/auth/**`
- `packages/shared/src/auth/**`, `packages/shared/src/index.ts`

## Contratos de saída

- `POST /auth/login {email,password} → {member, workspace}` + cookie. `POST /auth/logout`. `GET /api/me`.
- `IAuthProvider` exportado de `@hm/shared`.

## Definition of Done

- [ ] Login funciona com mock (seed owner) e, com `SUPABASE_*` setado, via Supabase.
- [ ] Cookie de sessão httpOnly emitido; logout limpa.
- [ ] `GET /api/me` resolve member+workspace+role a partir da sessão.
- [ ] `pnpm typecheck`, `pnpm lint` limpos.

## Validação

```bash
pnpm typecheck
pnpm lint
```

## Notas

- **Bloqueador externo:** auth Supabase "de verdade" exige projeto Supabase (URL+keys). Sem isso, o `mock-provider` cobre o fluxo. TODO marcado para troca.
