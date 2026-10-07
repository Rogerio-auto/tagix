---
id: F71-S15
title: Verify de cadastro define a senha e fecha o pre-hijack
phase: F71
status: available
priority: high
estimated_size: L
depends_on: [F71-S11, F71-S13]
blocks: []
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/features/PERMISSIONS.md
  - docs/security
---
# F71-S15 — Verify que define a senha (anti pre-hijack)

## Objetivo

Quem confirma o email é quem define a senha final. Um atacante que cadastrou o email de outra pessoa com uma senha dele não consegue entrar depois que a vítima confirma.

## Contexto

Achado F-07 (estrutural, auditoria F71): o signup cria a conta com a senha informada por quem digitou o email; a confirmação não rotaciona nada, então o autor do signup continua com a senha (pre-hijack clássico).

## Escopo (faz)

- `apps/api/src/auth/signup.ts`, `reset.ts`, `supabase-provider.ts`: o signup cria a conta com senha aleatória descartável e o `/verify` de cadastro exige `completeAccount`: quem confirma define a senha, invalidando qualquer anterior; token de uso único. Sessão só é emitida depois da senha definida.
- Web (`apps/web/features/auth/**`, páginas de verify/cadastro): passo "Definir senha" após o clique do email; a tela "Verifique seu email" mantém a pessoa informada; token expirado oferece reenvio uniforme.
- Template "Confirm signup" revisado se necessário (já em fragmento pela S11).
- **Decisão de UX a registrar:** a senha deixa de ser pedida no formulário inicial (só email + dados da empresa) em vez de pedida e descartada (menos fricção, sem senha morta). Impacto na F44 (cadastro/onboarding): formulário e eventos de funil mudam; listar o que a F44 precisa ajustar.

## Fora de escopo

- Headers/Sentry/fragmento (S11). Aceite inline de convite (S13).

### files_allowed

- `apps/api/src/auth/signup.ts`, `apps/api/src/auth/reset.ts`, `apps/api/src/auth/supabase-provider.ts`, `apps/api/src/auth/mock-provider.ts`, `apps/api/src/auth/provider.ts`, `apps/api/src/auth/routes.ts` (só rotas de verify/complete) e testes
- `apps/web/features/auth/**`, `apps/web/app/(auth)/verify/**`, `apps/web/app/(auth)/signup/**` (o que existir)
- `docs/runbooks/supabase-auth-emails.md`, `docs/features/CONTAS_E_CONVITES.md` (seção da decisão)
- testes ao lado e `apps/web/e2e/specs/**`

### files_forbidden

- `packages/db/**`, `apps/api/src/auth/invite.ts` (S13), `apps/web/next.config.mjs` e `instrumentation*` (S11)

## Definition of Done

- [ ] teste de ataque: A cadastra o email de B com senha X; B confirma e define Y; login com X falha, com Y funciona
- [ ] teste: verify sem definir senha não emite sessão; token reutilizado → erro uniforme
- [ ] teste: reenvio e erros continuam uniformes (sem oráculo de conta)
- [ ] e2e: cadastro → email → definir senha → entra na empresa
- [ ] decisão de UX e impacto na F44 registrados nas Notas
- [ ] revisão `/hm-security` do fluxo

## Validação

```bash
pnpm --filter @hm/api typecheck
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/auth --maxWorkers=1
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
node --env-file=.env apps/web/node_modules/vitest/vitest.mjs run --root apps/web --maxWorkers=1
```

## Notas

- Agentes: `backend-engineer` (API) e `frontend-engineer` (web); backend primeiro. Sugerida revisão `security-auditor`.
- Depende de S11 (verify/auth no web) e S13 (`apps/api/src/auth/**`).
