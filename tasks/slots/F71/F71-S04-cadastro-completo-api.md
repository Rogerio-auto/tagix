---
id: F71-S04
title: Cadastro sem beco sem saída — reenviar confirmação, login diz "confirme seu email", aceite de termos
phase: F71
status: in-progress
priority: high
estimated_size: S
depends_on: [F71-S02, F71-S03]
blocks: [F71-S09]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/features/SELF_SERVE_SIGNUP.md
agent_id: backend-engineer
claimed_at: 2026-10-05T17:07:09Z

---
# F71-S04 — Cadastro completo (API)

## Objetivo

Quem se cadastrou e perdeu ou deixou expirar o link de confirmação consegue recebê-lo de novo. O login diz claramente que falta confirmar o email. O aceite dos termos fica gravado.

## Contexto

A2, A3 e A7 da spec. Os controles de anti-enumeração da F44 continuam valendo.

## Escopo (faz)

- `POST /auth/resend-verification { email, turnstileToken }`:
  - captcha server-side e rate-limit por IP+email (`resend`, 3/h) e só por IP;
  - sempre `200 { ok: true }`; só chama `resendVerification` quando o email existe e não está confirmado, em tempo uniforme;
  - auditoria `auth.verification_resent`.
- Login: `AuthError` com código `email_unverified` → `403 { error: 'email_unverified', message: 'Confirme seu email para entrar.' }`.
  - Só responde assim **depois** de a senha ter sido aceita pelo provider (o Supabase só diz "não confirmado" com a senha certa), então não é vetor de enumeração. Confirmar esse comportamento e registrar no slot.
  - Não conta para o captcha progressivo.
- Signup:
  - o `signupSchema` ganha `acceptTerms: z.literal(true)` e `termsVersion`;
  - grava `terms_accepted_at`/`terms_version` no member OWNER. Coordenar: o provisionador (S01) aceita esses campos; se não aceitar, nota de correção aqui e ajuste mínimo no S01 antes do merge;
  - signup repetido de email já cadastrado e não confirmado reenvia a confirmação (hoje não reenvia), mantendo a resposta uniforme.
- Testes de cada caminho, incluindo o tempo uniforme do resend (mesmo padrão dos testes da F44).

## Fora de escopo

- UI (S09). Template do Supabase (S02).

### files_allowed

- `apps/api/src/auth/signup.ts`
- `apps/api/src/auth/resend.ts` (novo), `apps/api/src/auth/resend.test.ts`
- `apps/api/src/auth/routes.ts` (só registrar a rota e mapear `email_unverified`), `apps/api/src/auth/routes.test.ts`
- `apps/api/src/auth/flow.integration.test.ts`
- `apps/api/src/middlewares/rate-limit.ts`

### files_forbidden

- `apps/api/src/auth/session.ts` (S03), `packages/**`

## Definition of Done

- [ ] resend: 200 uniforme em email inexistente, confirmado e não confirmado; envia só no último caso (teste)
- [ ] login de não confirmado → 403 `email_unverified`, sem incrementar o captcha (teste)
- [ ] signup sem `acceptTerms` → 400; com ele → `terms_accepted_at` gravado (teste)
- [ ] signup repetido de não confirmado reenvia (teste)
- [ ] `docs/api-reference` atualizado se as rotas de auth estiverem documentadas lá

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api lint
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/auth --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`.
- Roda em paralelo com S05 e S06: S05 não toca `routes.ts` (monta o próprio router em `app.ts`).
