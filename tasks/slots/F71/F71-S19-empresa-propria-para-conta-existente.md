---
id: F71-S19
title: Criar empresa própria estando autenticado
phase: F71
status: available
priority: medium
estimated_size: M
depends_on: [F71-S10]
blocks: []
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/security
---
# F71-S19 — Criar empresa própria estando autenticado

## Objetivo

Quem já tem conta (ex.: convidado a outra empresa) cria a PRÓPRIA empresa logado, sem passar pelo signup público.

## Contexto

Hoje a pessoa com conta só ganha empresa própria pelo signup público. No Supabase real esse caminho NÃO envia email de verificação para conta confirmada, então a empresa pendente (`invited`) nunca ativa; e provisiona empresa `invited` na conta de terceiros (poluição, F-07-adj da auditoria da S10, revertido por decisão de produto até este slot).

## Escopo (faz)

- `POST /api/me/workspaces` autenticado: sessão + captcha opcional + rate limit; Zod strict (`name`, `acceptTerms`, `termsVersion`, `plan?`).
- Provisiona a empresa já `active` para a conta logada: OWNER, trial de 15 dias, termos gravados; define o cookie `hm_workspace`; audita.
- Signup público de conta já confirmada passa a NÃO provisionar (reaplica o F-07-adj: não provisiona, audita `existing_confirmed_account`) e responde uniforme, no mesmo piso de tempo.
- UI: ação "Criar nova empresa" no seletor de empresa (S08), com modal de nome + aceite de termos, e troca para a empresa criada.

## Fora de escopo

- Mudanças de billing/planos; convites (S05/S07).

### files_allowed

- `apps/api/src/auth/signup.ts` (e testes)
- `apps/api/src/routes/members/**` ou novo `apps/api/src/routes/workspace/create.ts` (e testes)
- `packages/db/src/provisioning/**` (se precisar de `active` direto)
- `apps/web/shared/components/workspace-switcher/**`
- `apps/web/features/**` de criação de empresa

### files_forbidden

- demais `packages/**`, `apps/workers/**`

## Definition of Done

- [ ] teste: autenticado cria empresa `active`, OWNER, trial 15 dias, termos gravados, `hm_workspace` definido, auditoria
- [ ] teste: sem sessão 401; sem aceite de termos 400; rate limit 429
- [ ] teste: signup público de conta confirmada não provisiona e responde igual
- [ ] teste de UI do seletor (criar e trocar de empresa)
- [ ] revisão de design (`/hm-designer`) do modal e da ação no seletor
- [ ] jornada `accounts-journey.integration.test.ts` ajustada ao novo caminho

## Validação

```bash
pnpm typecheck
pnpm lint
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src --maxWorkers=1
```

## Notas

- Agente: `backend-engineer` + `frontend-engineer`.
- Ordem: após a S10 (decisão registrada nas Notas de execução da S10).
