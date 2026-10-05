---
id: F71-S04
title: Cadastro sem beco sem saída — reenviar confirmação, login diz "confirme seu email", aceite de termos
phase: F71
status: review
priority: high
estimated_size: S
depends_on: [F71-S02, F71-S03]
blocks: [F71-S09]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/features/SELF_SERVE_SIGNUP.md
agent_id: backend-engineer
claimed_at: 2026-10-05T17:07:09Z
completed_at: 2026-10-05T17:08:12Z

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

## Notas de execução

- **`email_unverified` só com a senha certa (confirmado).** `SupabaseAuthProvider.signIn` só
  lança `email_unverified` quando o GoTrue responde `error_code: "email_not_confirmed"` (ou a
  mensagem legada "Email not confirmed") em `/token?grant_type=password`, e o GoTrue valida a
  senha antes de olhar a confirmação; senha errada continua `invalid_credentials` → 401
  genérico. O mock tem a mesma ordem. Logo o 403 não enumera contas.
- **Login:** `email_unverified` → `403 { error: 'email_unverified', message: 'Confirme seu
  email para entrar.' }`, sem cookie, sem `recordLoginFailure` (não arma o captcha
  progressivo); auditado como `auth.login_failed` com `reason: 'email_unverified'`. Os
  limitadores de borda (`login`/`login_ip`) continuam contando a tentativa.
- **`POST /auth/resend-verification`** (`auth/resend.ts`), ordem: `resend_ip` (20/h por IP) →
  `resend` (3/h por IP+email) → Zod strict `{ email, turnstileToken }` (400
  `invalid_payload`) → Turnstile server-side (400 `captcha_failed`) → trabalho condicional no
  piso de tempo → `200 { ok: true }`.
  - **Captcha recusado responde 400, não 200** (mesmo padrão do signup F44): o veredito sai
    antes de qualquer consulta e não depende da conta, então não enumera; responder 200 faria
    o usuário legítimo achar que o email saiu.
  - Envia só se `findUserByEmail` acha a conta, `emailConfirmed=false` e `hasPassword=true`.
    Conta de convite sem senha não recebe o email de cadastro (se completa pelo convite).
    `provider_error` no lookup → mesma resposta, auditado.
  - Auditoria `auth.verification_resent` com `{ email, outcome, via }`
    (`outcome`: `sent | no_account | already_confirmed | invite_pending | provider_error`);
    nunca senha nem token.
- **Tempo uniforme (`runWithUniformTiming`).** A F44 não tinha piso de tempo nem teste de
  tempo (só resposta uniforme); este slot criou o mecanismo e o aplicou ao resend **e** ao
  signup. A resposta sai EXATAMENTE no piso: trabalho mais rápido espera o restante; mais lento
  segue em segundo plano (erro logado sem PII e engolido). Piso padrão 1200 ms, ajustável por
  `AUTH_UNIFORM_RESPONSE_MS` (aceita 50–10000; fora disso cai no padrão). Efeito colateral
  aceito: o signup passa a responder em ~1,2 s, e um provider lento termina o
  provisionamento/envio logo depois do 202 (o signup já era idempotente e se refaz no retry).
  Env não documentado em `.env.example` (fora do `files_allowed`).
- **Signup:** `acceptTerms: z.literal(true)` + `termsVersion` em `AAAA-MM-DD` (data de
  calendário válida; atual = `2026-09-14`, o "Atualizados em" de `/termos` e `/privacidade`).
  `termsAcceptedAt` = relógio do servidor, nunca do cliente; vão ao provisionador da S01 sem
  ajuste. Signup repetido (`created:false`) chama o mesmo `resendVerificationIfPending` após
  o provisionamento idempotente; resposta e tempo inalterados.
- **`docs/api-reference`:** só documenta a API pública v1 (conversas, contatos, flows); as rotas
  de auth não estão lá, então nada a atualizar.
- **Testes:** `resend.test.ts` (novo, 17: casos, auditoria, entrada, tempo uniforme com
  mediana de 3 medições por caso e caso "provider mais lento que o piso"); `routes.test.ts`
  (+termos, signup repetido, rota de reenvio com composição dos limites, login 403);
  `flow.integration.test.ts` (termos gravados no OWNER, login 403 → verify → 200, reenvio
  real com o mock provider, signup repetido reenvia).

### Validação (2026-10-05)

- `pnpm --filter @hm/api typecheck` → ok.
- `pnpm --filter @hm/api lint` → o pacote não tem script; `npx eslint` nos 7 arquivos tocados
  → 0 problemas; `prettier --check` limpo.
- `vitest run src/auth --maxWorkers=1` → 7 arquivos, 175 testes, 0 falhas.
  `resend.test.ts` rodado mais 3× isolado → 17/17 em todas. `src/middlewares/rate-limit` →
  10/10.
