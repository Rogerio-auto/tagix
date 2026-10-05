---
id: F71-S05
title: Convite de verdade — criar, enviar, reenviar, revogar, copiar link e aceitar, com limite de membros
phase: F71
status: blocked
priority: critical
estimated_size: M
depends_on: [F71-S01, F71-S02, F71-S03]
blocks: [F71-S07]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/features/PERMISSIONS.md
---
# F71-S05 — Convites (API)

## Objetivo

O admin convida alguém por email. A pessoa recebe o email, abre o link, define a senha (ou aceita com a conta que já tem) e passa a ser membro ativo da empresa.

## Contexto

B1–B7 da spec. Contratos em §5, threat model em §6.

## Escopo (faz)

- Rotas autenticadas em `apps/api/src/routes/workspace/invites.ts`, gated por `member.invite`, sob `req.scoped`:
  - `GET /api/members/invites`: lista os pendentes;
  - `POST /api/members/invites { email, role, departmentId? }`:
    - rejeita OWNER;
    - rejeita email que já é member ativo (409 `already_member`);
    - convite pendente existente → reenvia em vez de duplicar;
    - aplica `max_members` via `resolveEntitlements` (ativos + pendentes; sem limite definido = ilimitado) → 402 `seat_limit`;
    - gera o token (32 bytes, base64url) e grava só o sha256;
    - envia pelo provider: `findUserByEmail` → `sendInvite` (sem conta) ou `sendSignInLink` (com conta), com `redirectTo = <app>/convite/<token>`;
    - auditoria `member.invited`;
  - `POST /api/members/invites/:id/resend`: gera token novo (invalida o anterior); teto de 5 reenvios e 1 por minuto;
  - `DELETE /api/members/invites/:id`: revoga;
  - `GET /api/members/invites/:id/link`: gera token novo e devolve o link para copiar, com auditoria;
  - limite por empresa: 30 convites/hora.
- `POST /api/members` (o "convite" antigo em `workspace.ts`) deixa de inserir member: responde `410` apontando para `/api/members/invites`, ou delega para o novo handler. Escolher, justificar e testar.
- `GET /api/members` passa a usar `member.invite` (coerente com a seção da UI) e marca o status `invited` legado, se sobrar algum.
- Rotas públicas em `apps/api/src/auth/invite.ts`, montadas como router próprio em `app.ts`, com rate-limit por IP:
  - `GET /auth/invite/:token` → preview (`workspaceName`, `inviterName`, `role`, `emailMasked`, `hasAccount`) ou 404 uniforme;
  - `POST /auth/invite/accept { token, name?, password? }`:
    - **sem conta / não confirmada:** `password` forte (reusa `strongPassword`) → `completeAccount` → cria member `active` com o `authUserId` real → marca aceito → `{ next: '/login?email=…' }`;
    - **com conta:** exige sessão (`hm_session`) cujo email = email do convite, senão 403 `wrong_account` → cria member → seta `hm_workspace` (helper da S03) → `{ next: '/' }`;
    - tudo em uma transação; uso único garantido por `update … where accepted_at is null and revoked_at is null and expires_at > now() returning`;
    - auditoria `member.joined`.
- `GET /api/me/invites`: convites pendentes para o email da sessão (o banner da S08 usa).

## Fora de escopo

- UI (S07). Admin da plataforma convidar (F67).

### files_allowed

- `apps/api/src/routes/workspace/invites.ts` (novo), `apps/api/src/routes/workspace/invites.test.ts`, `apps/api/src/routes/workspace/invites.integration.test.ts`
- `apps/api/src/routes/workspace/workspace.ts`, `apps/api/src/routes/workspace/index.ts`, `apps/api/src/routes/workspace/routes.test.ts`
- `apps/api/src/auth/invite.ts` (novo), `apps/api/src/auth/invite.test.ts`
- `apps/api/src/app.ts` (só montar o router público de convite)
- `apps/api/src/routes/members/invites-me.ts` (novo; montado pelo index de `routes/members` — **coordenar com a S03**, que é dona de `routes/members/**`: a S05 só começa depois do merge da S03 e adiciona uma linha no index)

### files_forbidden

- `apps/api/src/auth/routes.ts`, `session.ts` (S03/S04), `packages/**`

## Definition of Done

- [ ] teste: convite → aceite sem conta → login → member ativo com `authUserId` real
- [ ] teste: convite para pessoa com conta → aceite logado com o email certo; com email errado → 403
- [ ] teste: token reusado, expirado ou revogado → 404 uniforme
- [ ] teste: reenviar invalida o token anterior
- [ ] teste: `max_members` estourado → 402; convite OWNER → 400
- [ ] teste: RLS — admin da empresa A não lista nem revoga convite da B
- [ ] auditoria em convidar, reenviar, revogar, copiar link e aceitar
- [ ] token em claro nunca é logado (grep no log do teste)

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api lint
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/routes/workspace src/auth/invite.test.ts src/routes/members --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`. Pedir `security-auditor` antes do merge (slot sensível).
