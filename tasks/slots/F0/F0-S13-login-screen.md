---
id: F0-S13
title: Login + ResetPassword (DS v2, RHF + Zod) — primeira tela ponta-a-ponta
phase: F0
status: in-progress
priority: high
estimated_size: M
depends_on: [F0-S11, F0-S12]
agent_id: backend-engineer
claimed_at: 2026-06-09T13:36:25Z

---
# F0-S13 — Login + ResetPassword (primeira tela end-to-end)

> Refina o ROADMAP F0-S11 (login). É a primeira tela completa em DS v2 — prova o pipeline tokens → primitives → shell → UX infra.
> **source_docs:** `docs/DESIGN_SYSTEM.md` §9.5 (forms), §10; `docs/UX_PRINCIPLES.md` §2.7, §2.11, §4; `docs/features/PERMISSIONS.md` (auth)
> **blocks:** acesso autenticado ao app

## Objetivo

Implementar as telas de Login e Reset Password no DS v2, com React Hook Form + Zod, todos os estados (loading/erro/sucesso) e wiring ao endpoint de auth.

## Contexto

Com shell (F0-S11) e infra de UX (F0-S12) prontos, esta é a porta de entrada. Valida o sistema visual ponta a ponta e abre caminho p/ qualquer rota autenticada.

## Escopo (faz)

- `app/(auth)/login/page.tsx` — tela de login centrada (usa `(auth)/layout` de F0-S11).
- `app/(auth)/reset-password/page.tsx` — solicitar reset + (se aplicável) definir nova senha.
- `features/auth/components/LoginForm.tsx` — RHF + `zodResolver`, `Input` (email/senha) com error inline, `Button` `loading` no submit (DS §9.5).
- `features/auth/components/ResetPasswordForm.tsx`.
- `features/auth/schema.ts` — Zod (email, senha) reutilizável (idealmente alinhado a `@hm/shared`).
- `features/auth/queries.ts` — `useLogin`/`useRequestReset` (TanStack mutation) chamando `api` (`POST /auth/login`, `POST /auth/reset`).
- Estados: loading (Button spinner + disabled), erro (ErrorState/Toast com 3 partes p/ credencial inválida), sucesso (redirect p/ `/`).

## Fora de escopo

- Endpoints de auth no backend (ROADMAP F0-S05) — aqui consome o contrato; se o backend ainda não existe, usar mock atrás do `api-client` e marcar TODO (ver Notas).
- Cadastro/Signup e Landing (PRD: fase 2).
- MFA, social login.

## Arquivos permitidos

- `apps/web/app/(auth)/login/**`
- `apps/web/app/(auth)/reset-password/**`
- `apps/web/features/auth/**`

## Arquivos proibidos

- `apps/web/app/(auth)/layout.tsx`, `apps/web/app/layout.tsx`, `apps/web/shared/**` (F0-S11/S12)
- `packages/**`

## Contratos de entrada/saída

- `POST /auth/login { email, password } → { member, workspace }` + cookie de sessão (contrato de F0-S05).
- `POST /auth/reset { email } → 202`.
- Em sucesso, invalida query `['me']` e redireciona p/ `/`.

## Definition of Done

- [ ] Login funciona ponta a ponta (com backend real OU mock documentado) e redireciona.
- [ ] Form usa RHF + Zod; erros inline por campo.
- [ ] Loading (Button), erro (3 partes) e sucesso (toast) implementados.
- [ ] Dark e light ok; focus ring visível; Enter submete; Esc limpa foco.
- [ ] Zero hex hardcoded.
- [ ] `pnpm --filter @hm/web build`, `pnpm typecheck`, `pnpm lint` limpos.

## Permission scope

- Rota pública (não autenticada). Após login, o gate de rotas `(app)` (F0-S11) assume. Roles/`can()` entram com PERMISSIONS no backend (F0-S06).

## UX considerations

- Aplica UX §2.7 (click-fantasma): submit entra em loading + disabled, sem duplo-disparo.
- Aplica UX §2.11 (erro-misterioso): credencial inválida mostra "o quê / por quê / o que fazer", não "Erro 500".
- Aplica DS §9.5 (RHF+Zod), §8 (a11y: labels, aria-invalid, focus ring).
- Empty/loading não se aplicam a form; estados de submit sim.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

- Se F0-S05 (auth backend) ainda não fechou no claim deste slot: implementar contra um mock no `api-client` (flag `NEXT_PUBLIC_AUTH_MOCK`) e abrir COMMS pedindo o wiring real quando o backend chegar. Não bloquear a tela por isso, mas deixar o TODO explícito.
- e2e Playwright do fluxo de login fica num slot de testes/hardening (fase F9) ou anexado quando o backend real existir.
