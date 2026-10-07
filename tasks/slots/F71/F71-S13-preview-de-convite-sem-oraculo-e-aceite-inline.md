---
id: F71-S13
title: Preview de convite sem oráculo de conta e aceite inline autenticado
phase: F71
status: available
priority: medium
estimated_size: L
depends_on: [F71-S10, F71-S14]
blocks: [F71-S15, F71-S18]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/features/PERMISSIONS.md
---
# F71-S13 — Convite sem oráculo e aceite inline

## Objetivo

O preview público de um convite não revela se o email já tem conta, e quem já está logado aceita o convite pelo banner sem caçar o link do email.

## Contexto

Achado F-08 (auditoria F71): o preview expõe `requiresEmailProof`, que classifica o email como "tem conta"/"não tem". Follow-up da S08: o banner de convite pendente não tem botão de aceite porque `GET /api/me/invites` não devolve o token.

## Escopo (faz)

- `apps/api/src/auth/invite.ts`: remover `requiresEmailProof` (e qualquer campo derivado) do preview; resposta idêntica para email com e sem conta.
- UI (`apps/web/features/invites/**`): mostrar sempre as duas opções ("Entrar para aceitar" e "Criar conta") sem classificar o convidado.
- Novo `POST /api/me/invites/:id/accept` (autenticado, em `apps/api/src/routes/members/me.ts`): exige email da sessão == email do convite; **sem** `emailProof` (a sessão já prova a caixa); papel e `departmentId` vêm do convite, nunca do body; usa o repo da S14 (bloqueado não reativa); rate limit; auditoria `member.joined`.
- **Decisão a registrar:** pessoa com conta e **sem nenhuma empresa** hoje não obtém sessão. Sugestão: sessão "sem empresa" apenas para quem tem convite pendente (`/api/me` devolve `workspace: null` + convites pendentes; demais rotas respondem `409 no_workspace`); alternativa: aceite com reautenticação. Escolher uma e testar.
- Banner da S08 ganha o botão "Aceitar" chamando a rota; depois, a troca de empresa (limpa cache, reconecta).

## Fora de escopo

- Reativação de bloqueado e `departmentId` no repo (S14). Header por aba (S12).

### files_allowed

- `apps/api/src/auth/invite.ts`, `apps/api/src/auth/invite.test.ts`, `apps/api/src/auth/session.ts` (sessão sem empresa) e testes
- `apps/api/src/routes/members/me.ts` e teste
- `apps/web/features/invites/**`, `apps/web/app/(auth)/convite/**`
- `apps/web/shared/components/account-banner/**`
- testes ao lado, `apps/web/e2e/specs/members-invites.spec.ts`, `apps/web/e2e/fixtures/api-mock.ts`

### files_forbidden

- `packages/**` (S14), `apps/web/next.config.mjs` e `instrumentation*` (S11), `apps/api/src/middlewares/auth.ts` (S12/S18)

## Definition of Done

- [ ] teste: preview de email com conta e sem conta devolve corpo idêntico (mesmas chaves e formato)
- [ ] teste: `POST /api/me/invites/:id/accept` com email da sessão diferente → 403; igual → membership criada com o papel do convite
- [ ] teste: convite expirado/revogado/usado → erro uniforme; `blocked` não reativa (via S14)
- [ ] teste: pessoa com conta e sem empresa, com convite pendente, aceita; sem convite continua sem acesso
- [ ] e2e: banner mostra "Aceitar", aceita e cai na empresa nova
- [ ] capturas 375/768/1440 dark+light do convite e do banner; axe limpo; revisão `/hm-designer`

## Validação

```bash
pnpm --filter @hm/api typecheck
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/auth src/routes/members --maxWorkers=1
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web lint
node --env-file=.env apps/web/node_modules/vitest/vitest.mjs run --root apps/web --maxWorkers=1
```

## Notas

- Agentes: `backend-engineer` e `frontend-engineer` (slot misto; backend primeiro). Sem `ui: true` pleno: a revisão visual cobre só o convite e o banner.
- `apps/api/src/auth/**` é compartilhado com a S15, que por isso depende desta.
