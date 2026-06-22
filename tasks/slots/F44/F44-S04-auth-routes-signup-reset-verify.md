---
id: F44-S04
title: Rotas POST /auth/signup, /auth/reset (real), /auth/verify — anti-enum, captcha, rollback
phase: F44
status: in-progress
priority: high
estimated_size: L
depends_on: [F44-S01, F44-S02, F44-S03]
blocks: [F44-S05, F44-S06, F44-S07]
agent_id: backend-engineer
security_review: required
source_docs:
  - docs/features/SELF_SERVE_SIGNUP.md
claimed_at: 2026-06-22T18:40:52Z

---
# F44-S04 [SEC] — Rotas de auth do cadastro self-serve

> source_docs: docs/features/SELF_SERVE_SIGNUP.md §3, §5
> depends_on: S01 (provider), S02 (provisioner), S03 (rate-limit/captcha). blocks: S05/S06/S07.

## Objetivo

Expor os endpoints HTTP que orquestram o cadastro self-serve, reset real e verify, costurando
provider (S01) + provisioner (S02) + rate-limit/captcha/audit (S03) com anti-enumeracao,
timing uniforme e rollback de signup parcial.

## Escopo (faz)

Em apps/api/src/auth/routes.ts + novos apps/api/src/auth/signup.ts e apps/api/src/auth/reset.ts:

- POST /auth/signup:
  1. Zod strict (name, email, password, workspaceName, turnstileToken). Senha com forca minima.
     Rejeita campos extras (sem workspaceId/role/isPlatformAdmin do body — T9).
  2. verifyTurnstile (S03) — falha resulta em 400 uniforme.
  3. Rate-limit por IP+email (S03).
  4. Denylist de email descartavel (mailinator/temp-mail/etc.) — manter a lista no slot
     (constante/JSON pequeno em signup.ts); dominio descartavel resulta em resposta uniforme.
  5. provider.signUp com email_confirm:false (S01); provisiona via provisionWorkspaceWithOwner
     (S02). Rollback/compensacao (T14): se o provider criou o user mas o provisionamento falhou,
     compensar (deletar/marcar o user orfao) e responder uniforme — sem estado parcial.
  6. SEM auto-login (nao seta cookie de sessao). Audit log (T10).
  7. Resposta uniforme 202 status verification_sent mesmo se o email ja existe (T3/T13) — timing
     uniforme (nao fazer trabalho condicional observavel).
- POST /auth/reset (substitui o mock): Zod (email), rate-limit, provider.requestPasswordReset,
  resposta uniforme 200 ok:true (anti-enumeracao, timing uniforme), audit.
- POST /auth/verify: Zod (token), provider.verifyEmailToken (S01). Em sucesso, ativa o member
  (status:active) via repo do workspace dele e responde 200 ok:true. Falha resulta em 400
  uniforme. (Decisao: verify NAO faz auto-login — usuario vai ao /login.)
- Wire dos middlewares de S03 nas rotas; manter /auth/login existente (adicionar so rate-limit
  + audit de login-falho, sem regredir o contrato atual). Rotacao de cookie no login mantida.

## Fora de escopo

- UI (S05/S06). Mudar app.ts (router ja montado). Tocar @hm/db/@hm/shared internamente
  (consome os exports de S01/S02).

## Arquivos permitidos

- apps/api/src/auth/routes.ts
- apps/api/src/auth/signup.ts (novo)
- apps/api/src/auth/reset.ts (novo)
- apps/api/src/auth/routes.test.ts (novo)

## Arquivos proibidos

- apps/api/src/app.ts, apps/api/src/middlewares/** (consumir, nao editar)
- packages/**, apps/web/**

## Definition of Done

- [ ] Zod strict em todo body; sem any; rejeita campos extras (T2, T9).
- [ ] Signup: captcha + rate-limit + denylist descartavel + provisioner + rollback (T4,T13,T14).
- [ ] Resposta e timing UNIFORMES em signup/reset (anti-enumeracao T3); sem auto-login (T7).
- [ ] Reset real (nao-mock); verify ativa o member so pos-token valido (T7).
- [ ] Senha nunca logada (T6); audit log em signup/login-falho/reset (T10).
- [ ] Testes: payload invalido, captcha invalido, rate-limit, email duplicado uniforme,
      rollback de provisionamento falho, verify valido/invalido.
- [ ] pnpm typecheck + pnpm lint + pnpm --filter @hm/api test verdes.

## Validacao

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/api test
```

## Notas

- Especialista: backend-engineer. [SEC] — gate antes do finish: T3 (uniformidade resposta+timing),
  T9 (sem privilegio/sem campos do body), T14 (rollback), T10 (audit). Este e o slot mais sensivel.
