---
id: F71-S02
title: Provider de auth envia convite, define senha e acha usuário por email exato; runbook dos templates do Supabase
phase: F71
status: done
priority: critical
estimated_size: S
depends_on: []
blocks: [F71-S03, F71-S04, F71-S05]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/features/SELF_SERVE_SIGNUP.md
agent_id: backend-engineer
claimed_at: 2026-10-05T16:03:35Z
completed_at: 2026-10-05T16:05:27Z

---
# F71-S02 — Provider de auth: convite, senha, lookup exato e templates

## Objetivo

O `IAuthProvider` ganha o que convite e cadastro completo precisam, e existe um runbook que deixa o Supabase de produção configurado para o link de confirmação de fato ativar a conta.

## Contexto

Achados A1, A4 e B3 da spec. O `verifyEmailToken` espera `token_hash`, mas nada garante que o template do Supabase o envie. O `lookupUserId` usa `filter=email eq "x"`, que o GoTrue trata como busca por trecho. Não há método para convidar nem para definir senha.

## Escopo (faz)

- Contrato em `packages/shared/src/auth/index.ts`:
  - `findUserByEmail(email): Promise<{ authUserId; emailConfirmed; hasPassword } | null>`;
  - `sendInvite(email, redirectTo): Promise<{ authUserId }>`: pessoa sem conta → `auth.admin.inviteUserByEmail`;
  - `sendSignInLink(email, redirectTo): Promise<void>`: pessoa com conta → `signInWithOtp({ shouldCreateUser:false, emailRedirectTo })`;
  - `completeAccount(authUserId, password): Promise<boolean>`: admin update com `password` + `email_confirm:true`;
  - `updatePassword(authUserId, password): Promise<boolean>`;
  - `signIn` passa a distinguir `AuthError` com código novo `email_unverified` quando o Supabase recusa por email não confirmado.
- `supabase-provider.ts`:
  - implementar os métodos;
  - corrigir `lookupUserId`: comparar o email **exato** no resultado, paginando. Conferir no Supabase real como o `filter` se comporta e registrar no slot;
  - redirect via `AUTH_EMAIL_REDIRECT_URL`, como hoje.
- `mock-provider.ts`: implementar em memória (sem email). Não pode quebrar o fail-fast de mock em produção.
- Testes do provider com `fetch` mockado, cobrindo email exato, código `email_unverified` e convite para email já existente.
- Runbook `docs/runbooks/supabase-auth-emails.md`:
  - templates "Confirm signup" (`{{ .SiteURL }}/verify?token_hash={{ .TokenHash }}&type=email`), "Reset password", "Invite user" e "Magic link", com o texto em pt-BR e a marca Leadium;
  - Redirect URLs (`/verify`, `/reset-password`, `/convite/**`);
  - SMTP próprio, porque o embutido tem limite baixo;
  - como testar cada email ponta a ponta.

## Fora de escopo

- Rotas que usam os métodos (S03/S04/S05).

### files_allowed

- `packages/shared/src/auth/**`
- `apps/api/src/auth/supabase-provider.ts`
- `apps/api/src/auth/supabase-provider.test.ts`
- `apps/api/src/auth/mock-provider.ts`
- `apps/api/src/auth/provider.ts`
- `apps/api/src/auth/provider.test.ts`
- `docs/runbooks/supabase-auth-emails.md`

### files_forbidden

- `apps/api/src/auth/routes.ts`, `session.ts`, `signup.ts`, `reset.ts` (S03/S04)

## Definition of Done

- [ ] contrato novo com JSDoc das garantias de anti-enumeração
- [ ] supabase e mock implementam; testes cobrem cada método
- [ ] `lookupUserId` só devolve o usuário de email idêntico (teste com dois emails que compartilham trecho)
- [ ] `signIn` lança `email_unverified` no caso certo
- [ ] runbook escrito, com checklist de verificação em produção
- [ ] typecheck de `@hm/shared` e `@hm/api` verde

## Validação

```bash
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api exec vitest run src/auth/supabase-provider.test.ts src/auth/provider.test.ts --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`.
- Ação do Rogério, fora do código: aplicar o runbook no painel do Supabase de produção. Sem isso, nenhum cadastro novo se ativa (A1).

## Notas de execução

- **`filter` do GoTrue (A4).** Não houve acesso ao Supabase de produção (sem credenciais
  para o agente). Evidência usada: o código do GoTrue (`internal/models/user.go`,
  `FindUsersInAudience`) aplica o `filter` como trecho — `email LIKE %filter%` OU
  `raw_user_meta_data->>'full_name' ILIKE %filter%` — e o `auth-js` 2.108 (`listUsers`) nem
  expõe `filter`, ou seja, não é linguagem de consulta. Consequência: o antigo
  `filter=email eq "x"` procurava o texto literal `email eq "x"` dentro do email e **nunca**
  achava ninguém; o retry do órfão no signup sempre devolvia `authUserId: ''`.
- **Correção robusta independente do comportamento do servidor:** o adapter passa o próprio
  email (minúsculo) só para estreitar, compara o endereço inteiro em cada item e pagina
  (`per_page=100`, até 50 páginas) até uma página incompleta. Se o servidor ignorar o `filter`,
  o resultado continua certo. Erro/formato inesperado/teto estourado → `provider_error`
  ("não sei" nunca vira "não existe"). Conferência no projeto real: runbook §5.5.
- **`email_unverified`:** o GoTrue valida a senha antes de checar a confirmação
  (`/token?grant_type=password` → 400 `error_code: "email_not_confirmed"`), então o código só
  aparece com a senha certa. O adapter aceita também a mensagem legada "Email not confirmed".
- **Contrato:** os verbos novos ficaram em `IAccountAuthProvider extends IAuthProvider` (é o tipo
  de `getAuthProvider()`), para o dublê de `routes.test.ts` (fora deste slot) seguir compilando.
- **`hasPassword`:** o GoTrue não expõe o hash; o adapter grava `app_metadata.hm_password_set`
  sempre que define senha (signUp, reset, completeAccount, updatePassword). Conta sem a marca
  conta como "tem senha" se não nasceu de convite (`invited_at` nulo).
- **Pendente fora do `files_allowed`:** `apps/api/src/routes/members/me.ts:121` faz um cast para
  `{ updatePassword?: (email, pw) => Promise<void> }`, que agora não compila (TS2352) e, em
  runtime, chamaria o método solto com o email no lugar do id (TypeError → 500). Corrige na
  F71-S03 trocando por `provider.updatePassword(req.auth!.member.authUserId, newPassword)`.
