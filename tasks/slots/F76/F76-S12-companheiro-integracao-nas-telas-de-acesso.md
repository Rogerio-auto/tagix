---
id: F76-S12
title: Companheiro das telas de acesso — integração (layout, AuthKit e formulários de login, cadastro, verificação, reset e convite)
phase: F76
status: review
priority: high
estimated_size: M
model: sonnet
ui: true
depends_on: [F76-S10]
blocks: [F76-S13]
source_docs:
  - docs/design/auth-companion/SPEC.md
agent_id: frontend-engineer
claimed_at: 2026-10-19T17:58:54Z
completed_at: 2026-10-19T21:08:55Z

---
# F76-S12 — Integração nas telas de acesso

## Objetivo

Ligar os formulários existentes ao companheiro por sinais (nunca por conteúdo): cada etapa anuncia onde está, cada
envio/erro/sucesso emite um sinal, e a troca de etapa passa a usar fade+blur curto. Programa contra o contrato e o
stub no-op do S10; roda em paralelo ao S11.

## Escopo (faz)

- `apps/web/app/(auth)/layout.tsx`: envolve a raiz com `<AuthCompanionRoot>`; `<CompanionPerch/>` dentro do
  `BrandPanel`; `<CompanionInlineSlot/>` (`lg:hidden size-10 ml-auto`) na linha do `Logo`. Sem deslocar layout.
- `AuthKit.tsx`: ref `heading` no `<header>` do `AuthHeading`; `AuthStepTransition` (saída: opacity→0 e blur 0→4 px
  em 160 ms; entrada: opacity, blur 4→0 e translateY 4→0 em 240 ms; blur só no bloco trocado; **não atrasa** o foco no
  H1; reduced-motion: só opacity em 120 ms).
- `LoginForm.tsx`: `useAuthCompanionStep('login')`; `submit` antes do `mutateAsync`; 401 ⇒ `error{credentials}`; outros
  ⇒ `error{server}`; 403 não verificado ⇒ `settled`; sucesso ⇒ `success{final:false}` e o `router.push` sai **no mesmo
  tick** (sem retenção artificial); `handleSubmit(onValid, onInvalid)` ⇒ `error{validation}`.
- `SignupForm.tsx`: `signup`/`signup-sent` com `success{final:true}`; Turnstile ausente ⇒ `validation`; `catch` ⇒ `server`.
- `VerifyEmail.tsx`: `verify-pending` + `submit` na montagem ⇒ `verify-done` (`final`) ou `verify-invalid` + `error server`.
  (O Leadium verifica por **link com `?token=`**; não existe campo de código — não criar.)
- `ResetPasswordForm.tsx`, `NewPasswordForm.tsx`: fases equivalentes (`reset-request`/`reset-sent`/`reset-new`/`reset-done`).
- `apps/web/features/invites/components/InviteScreen.tsx` e `CreatePasswordForm.tsx`: `invite` e `invite-done`.
- Testes de tela existentes continuam verdes, com asserção de que os sinais disparam (mock do hook).

## Fora de escopo

- Motor e arte (S10/S11); e2e (S13); alterar regras de validação, copy dos formulários ou fluxos de auth.

### files_allowed

- `apps/web/app/(auth)/layout.tsx`
- `apps/web/features/auth/components/AuthKit.tsx`
- `apps/web/features/auth/components/LoginForm.tsx`
- `apps/web/features/auth/components/SignupForm.tsx`
- `apps/web/features/auth/components/VerifyEmail.tsx`
- `apps/web/features/auth/components/ResetPasswordForm.tsx`
- `apps/web/features/auth/components/NewPasswordForm.tsx`
- `apps/web/features/auth/components/auth-screens.test.tsx`
- `apps/web/features/invites/components/InviteScreen.tsx`
- `apps/web/features/invites/components/CreatePasswordForm.tsx`

### files_forbidden

- `apps/web/features/auth/companion/**`
- `apps/api/**`
- `packages/**`

## Definition of Done

- [ ] todos os fluxos emitem os sinais do contrato nas fases certas
- [ ] a troca de etapa não atrasa o foco em H1 nem causa layout shift
- [ ] nenhum valor de campo é passado ao companheiro (revisão de diff)
- [ ] testes e typecheck verdes; zero `any`

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
pnpm --filter @hm/web exec vitest run --maxWorkers=1 features/auth features/invites
```

## Notas

- Agente: `frontend-engineer` (Sonnet). Worktree próprio; arquivos disjuntos do S11.
