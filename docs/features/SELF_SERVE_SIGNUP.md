# F44 — Loading & Cadastro self-serve

> Status: aprovado (Rogério, 2026-06-22). Plano travado. Decompõe em 8 slots (S01–S08).
> Permite que qualquer pessoa crie uma conta Leadium pela web (signup self-serve),
> com verificação de email como bloqueio duro, provisionamento isolado de workspace,
> e fluxo real de reset/verify — endurecendo a borda de auth de ponta a ponta.

## 1. Objetivo

Hoje o único caminho para uma conta é o `seed-owner` (privilegiado, server-side, OWNER +
platform admin). Não há cadastro pela UI; `reset-password` é mock; não há verificação de
email no produto. A F44 abre o cadastro self-serve **sem afrouxar nenhuma invariante de
segurança**: nenhum signup recebe `isPlatformAdmin`, o tenant nasce inativo até o email ser
confirmado, e o provisionamento corre num caminho privilegiado isolado antes de cair em RLS.

## 2. Decisões travadas (Rogério)

1. **Verificação de email = bloqueio duro.** Usuário NÃO acessa o app até confirmar o email.
   `email_confirm:false` no Supabase; sessão só plena após verify; member/tenant fica `pending`
   até confirmar. SEM auto-login pós-signup.
2. **Billing:** signup cria assinatura **trial no plano `free`** (idêntico ao `seed-owner`).
   Upgrade pelo fluxo de billing F42 existente. **NÃO tocar `@hm/payments`.**
3. **Captcha:** Cloudflare Turnstile com **verify server-side**. CSP libera SÓ o domínio do
   Turnstile (`script-src`/`frame-src`/`connect-src`), sem `unsafe-*`.
4. **Bloquear emails descartáveis** (denylist mailinator/temp-mail/etc.) no signup.

Defaults aplicados: nenhum signup recebe `isPlatformAdmin` (invariante); rebrand
"Highermind" → "Leadium" nas telas de auth de passagem; slug do workspace auto a partir do
nome (com dedupe, `workspaces.slug` é UNIQUE); validação de força de senha.

## 3. Threat model (T1–T14)

| # | Ameaça | Controle | Slot |
|---|--------|----------|------|
| T1 | Segredo/PII no bundle do cliente | Só `NEXT_PUBLIC_*`; auditar bundle por `SUPABASE_SERVICE` | S05/S06/S08 |
| T2 | Input não validado | Zod strict server-side em todo body | S04 |
| T3 | Enumeração de conta | Resposta + timing uniformes em signup/login/reset | S04 |
| T4 | Brute-force / mass-signup / credential-stuffing | Rate-limit Redis (IP+email) + Turnstile | S03 |
| T5 | Sessão fraca | Cookie httpOnly+Secure+SameSite; rotação no login/signup; invalidação no logout | S03/S04 |
| T6 | Senha em claro/log | Nunca logar senha; força mínima | S01/S04 |
| T7 | Acesso pré-verify | Sessão plena só pós-verify; member `pending` | S04/S07 |
| T8 | Provisioner vazando entre tenants | Caminho privilegiado isolado, depois TUDO `withWorkspace` | S02 |
| T9 | Escalonamento de privilégio | Sem `isPlatformAdmin`; não aceitar `workspaceId`/`role` do body | S02/S04 |
| T10 | Sem trilha de auditoria | Audit log em signup/login-falho/reset | S03/S04 |
| T11 | Open-redirect no return URL | Allowlist interna (só paths same-origin) | S07 |
| T12 | CSP frouxa | CSP libera só o domínio do captcha | S03 |
| T13 | Signup duplicado | Idempotente + resposta uniforme | S02/S04 |
| T14 | Signup parcial | Rollback/compensação (user Supabase criado, tenant falhou → compensa) | S04 |

## 4. Decomposição (ondas)

- **Onda 1 (paralelos, pacotes disjuntos):** S01 (@hm/shared + provider), S02 (@hm/db provisioner).
- **Onda 2:** S03 (security/rate-limit/CSP) → S04 (rotas de auth; dep S01+S02+S03).
- **Onda 3:** S05 (signup UI), S06 (reset/verify UI), S07 (hardening loading/sessão; após S05 por middleware).
- **Onda 4:** S08 (pass final /hm-security + /hm-adversarial + integração).

Ver slots em `tasks/slots/F44/`.

## 5. Contratos de API

- `POST /auth/signup` → `202 { status: 'verification_sent' }` (uniforme; mesmo se email já existe).
  Body: `{ name, email, password, workspaceName, turnstileToken }`. Sem auto-login.
- `POST /auth/reset` → `200 { ok: true }` (uniforme/anti-enumeração).
- `POST /auth/verify` → `200 { ok: true }` após confirmar o token de verificação.

## 6. Fora de escopo

- Mudar `@hm/payments` / fluxo de billing F42.
- Onboarding de nicho pós-signup (F43 já cobre via `/api/onboarding/apply`; signup só provisiona o esqueleto).
- E2E Playwright (não hidrata neste host — valida-se por typecheck/lint/build/unit).
