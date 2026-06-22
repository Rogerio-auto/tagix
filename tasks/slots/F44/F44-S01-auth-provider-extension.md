---
id: F44-S01
title: Estende IAuthProvider com signup/reset/resend/verify (contrato + supabase + mock)
phase: F44
status: review
priority: high
estimated_size: M
depends_on: []
blocks: [F44-S04]
agent_id: backend-engineer
security_review: required
source_docs:
  - docs/features/SELF_SERVE_SIGNUP.md
claimed_at: 2026-06-22T18:14:14Z
completed_at: 2026-06-22T18:31:05Z

---
# F44-S01 [SEC] — Extensão do contrato de autenticação

> **source_docs:** `docs/features/SELF_SERVE_SIGNUP.md` §2, §3 (T6, T7)
> **depends_on:** nenhum (onda 1). **blocks:** F44-S04.

## Objetivo

Estender `IAuthProvider` com os verbos que o cadastro self-serve exige, e implementar
nos dois adapters (Supabase real + mock dev). Apenas o contrato + adapters — SEM rotas,
SEM provisionamento (isso é S04/S02).

## Escopo (faz)

Em `packages/shared/src/auth/index.ts`, adicionar à interface `IAuthProvider`:
- `signUp(input: { email; password }): Promise<{ authUserId: string; created: boolean }>` —
  cria o usuário no provider com **`email_confirm: false`** (bloqueio duro). `created:false`
  quando o email já existe (idempotente; NÃO vaza isso como erro — o caller uniformiza).
- `requestPasswordReset(email: string): Promise<void>` — dispara o email de reset. Sempre
  resolve (anti-enumeração; nunca sinaliza se o email existe).
- `resendVerification(email: string): Promise<void>` — reenvia o email de verificação. Sempre resolve.
- `verifyEmailToken(token: string): Promise<AuthIdentity | null>` — valida o token de verificação
  de email vindo do link; retorna a identidade confirmada ou null.

Implementar em:
- `apps/api/src/auth/supabase-provider.ts` (`SupabaseAuthProvider`): usar a admin REST API /
  client `auth.admin` (criar user com `email_confirm:false`), `resetPasswordForEmail`, e a
  verificação de token (`verifyOtp`/`getUser` conforme o fluxo Supabase). Service key vem de env
  server-side — **nunca** exposta. Construtor pode receber a service key opcionalmente.
- `apps/api/src/auth/mock-provider.ts` (`MockAuthProvider`): implementação dev coerente
  (signUp idempotente por email em memória/no-op; verify aceita token bem-formado). Não quebra
  o login mock atual.

## Fora de escopo

- Rotas HTTP (S04), provisionamento de workspace (S02), rate-limit/captcha (S03), UI (S05/S06).
- Mudar a assinatura de `signIn`/`verifyToken`/`signOut` existentes.

## Arquivos permitidos

- `packages/shared/src/auth/index.ts`
- `apps/api/src/auth/supabase-provider.ts`
- `apps/api/src/auth/mock-provider.ts`
- `apps/api/src/auth/provider.ts` (só se o construtor precisar da service key; minimal)

## Arquivos proibidos

- `apps/api/src/auth/routes.ts`, `session.ts` (S04)
- `packages/db/**`, `apps/web/**`

## Definition of Done

- [ ] Contrato estendido; zero `any` (use `unknown` + narrowing/Zod onde parsear resposta externa).
- [ ] Supabase cria user com `email_confirm:false` confirmado no código.
- [ ] Mock implementa os 4 verbos sem regredir o login dev.
- [ ] `signUp` idempotente (email existente → `created:false`, sem throw).
- [ ] Nenhuma senha é logada (T6).
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: **backend-engineer**. [SEC] — gate security-auditor antes do finish: foco em
  T6 (senha nunca logada) e em o adapter Supabase NÃO confirmar email automaticamente.
