---
id: F71-S09
title: Telas de cadastro sem beco sem saída — reenviar confirmação, login de não confirmado e aceite de termos
phase: F71
status: blocked
priority: high
estimated_size: S
ui: true
depends_on: [F71-S04]
blocks: [F71-S10]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/features/SELF_SERVE_SIGNUP.md
  - docs/UX_PRINCIPLES.md
---
# F71-S09 — Cadastro completo (UI)

## Objetivo

Em nenhuma tela de entrada a pessoa fica sem próximo passo.

## Escopo (faz)

- Signup:
  - caixa obrigatória "Li e aceito os Termos de uso e a Política de privacidade", com links para `/termos` e `/privacidade`; envia `acceptTerms` e `termsVersion`;
  - a tela "verifique seu email" ganha "Reenviar email", com Turnstile, contagem de 60s entre reenvios e mensagem uniforme.
- Login:
  - `403 email_unverified` → "Confirme seu email para entrar." + "Reenviar confirmação" inline, sem perder o email digitado;
  - `?email=` pré-preenche o campo (vem do aceite de convite);
  - mensagem de "conta criada" quando vier do convite.
- `/verify`:
  - link inválido ou expirado → campo de email + reenviar, em vez de beco;
  - sucesso → "Email confirmado" + ir para o login com o email.
- Ajustar o e2e `auth.spec` "credenciais inválidas", que espera um texto antigo (pendência da F70-S28).

### files_allowed

- `apps/web/features/auth/**`
- `apps/web/app/(auth)/login/**`, `apps/web/app/(auth)/signup/**`, `apps/web/app/(auth)/verify/**`
- `apps/web/e2e/specs/auth*.spec.ts`, `apps/web/e2e/specs/signup*.spec.ts`

### files_forbidden

- `apps/web/app/(auth)/convite/**` (S07), `apps/web/shared/**` (S07/S08)

## Definition of Done

- [ ] testes de componente: reenviar com contagem; login de não confirmado; verify expirado
- [ ] signup bloqueia sem o aceite (teste)
- [ ] e2e de auth verde
- [ ] capturas 375/1440 em dark e light, axe (`~/.claude/skills/canone/VERIFICACAO.md`)
- [ ] revisão `/hm-designer` aprovada

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
pnpm --filter @hm/web exec vitest run features/auth --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`.
- Pode correr em paralelo com S07 e S08 (paths disjuntos).
