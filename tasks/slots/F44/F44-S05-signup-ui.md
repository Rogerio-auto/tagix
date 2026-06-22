---
id: F44-S05
title: UI de cadastro self-serve — /signup + SignupForm + Turnstile + PUBLIC_PREFIXES
phase: F44
status: blocked
priority: high
estimated_size: M
depends_on: [F44-S04]
blocks: [F44-S07]
agent_id: frontend-engineer
security_review: optional
source_docs:
  - docs/features/SELF_SERVE_SIGNUP.md
---
# F44-S05 — UI de cadastro

> source_docs: docs/features/SELF_SERVE_SIGNUP.md §5
> depends_on: S04 (POST /auth/signup). blocks: S07 (conflito em middleware.ts — S07 vem depois).

## Objetivo

Tela de cadastro self-serve leve e world-class (dark-first, DS v2), com widget Turnstile e
zero segredo no cliente. Referencia de UX (NAO copiar): projeto v1
C:\Users\Ueverton\Desktop\Projeto Saas\livechat-monorepo\frontend\src\pages\cadastro\** e
components\cadastro\OnboardingModal.tsx.

## Escopo (faz)

- apps/web/app/(auth)/signup/page.tsx — branding Leadium (nao Highermind), copy de cadastro.
- apps/web/features/auth/components/SignupForm.tsx — react-hook-form + zodResolver, campos
  name/email/password/workspaceName, indicador de forca de senha, widget Cloudflare Turnstile
  (site key via NEXT_PUBLIC_TURNSTILE_SITE_KEY — so NEXT_PUBLIC_*; nunca o secret). On success:
  estado de "verifique seu email" (sem auto-login, sem redirect ao app). Erros UX §2.11.
- Estender apps/web/features/auth/schema.ts com signupSchema e apps/web/features/auth/queries.ts
  com useSignup (POST /auth/signup). Resposta uniforme tratada como sucesso de verificacao.
- middleware.ts: somar /signup a PUBLIC_PREFIXES. (NOTA: S07 tambem edita middleware.ts para
  somar /verify e hardening — por isso S05 e sequenciado ANTES de S07; nao paralelizar com S07.)

## Fora de escopo

- /verify e reset real (S06). Hardening de loading/sessao/open-redirect (S07).

## Arquivos permitidos

- apps/web/app/(auth)/signup/**
- apps/web/features/auth/components/SignupForm.tsx
- apps/web/features/auth/schema.ts
- apps/web/features/auth/queries.ts
- apps/web/middleware.ts

## Arquivos proibidos

- apps/web/app/(auth)/verify/**, reset-password/** (S06)
- apps/web/shared/stores/auth.store.ts, shared/lib/** (S07)
- apps/**/api/**, packages/**

## Definition of Done

- [ ] Tela /signup acessivel (publica), branding Leadium, DS v2 (tokens semanticos, zero hex).
- [ ] Widget Turnstile renderiza com site key NEXT_PUBLIC_*; ZERO segredo no cliente (T1).
- [ ] Forca de senha visivel; validacao Zod client espelha o server (defesa, nao confianca).
- [ ] On success: estado verifique-seu-email, SEM auto-login/redirect ao app (T7).
- [ ] /signup em PUBLIC_PREFIXES; nao regride o guard das demais rotas.
- [ ] pnpm typecheck + pnpm lint + pnpm --filter @hm/web build verdes.

## Validacao

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Especialista: frontend-engineer. E2E Playwright NAO hidrata neste host — validar por
  typecheck/lint/build. Referencia v1 e inspiracao, nao codigo a portar.
