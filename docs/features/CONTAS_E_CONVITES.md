# F71 — Contas: convite de usuários, várias empresas por pessoa, cadastro completo e trial

> Status: aprovado (Rogério, 2026-10-05). Origem: levantamento do mesmo dia sobre o fluxo de
> cadastro de empresas e usuários. Onboarding assistido pelo painel de plataforma (admin cria a
> empresa e convida o dono) **fica fora** — vai para a F67 (template de workspace).

## 1. Objetivo

Fechar o caminho de entrada no Leadium de ponta a ponta:

1. **Empresa nova pelo site** (F44) funciona sem beco sem saída: link de confirmação que de fato
   ativa, reenviar confirmação, login que diz "confirme seu email", aceite de termos gravado.
2. **Usuário convidado** recebe um email de verdade, abre o link, define a senha e entra na empresa
   que o convidou. Hoje o convite só grava uma linha e o toast "Convite enviado." é falso.
3. **Uma pessoa pode estar em várias empresas** e trocar entre elas. Hoje `findByEmail` devolve
   uma linha qualquer e não há seletor.
4. **Trial de 15 dias**, com expiração automática. Empresa com assinatura `expired` ou `canceled`
   fica **só leitura**.

## 2. Estado de partida (levantamento 2026-10-05)

| # | Achado | Onde |
|---|---|---|
| A1 | `/verify` só funciona se o template "Confirm signup" do Supabase mandar `token_hash`. Com o template padrão o dono fica `invited` para sempre. Sem runbook. | `apps/web/features/auth/components/VerifyEmail.tsx:18`, `apps/api/src/auth/supabase-provider.ts:168` |
| A2 | Sem rota/tela de reenviar confirmação. Link expirado = conta sem saída. | `apps/api/src/auth/routes.ts` |
| A3 | Login de quem não confirmou responde "Email ou senha incorretos" e conta para o captcha. | `apps/api/src/auth/routes.ts:94-102` |
| A4 | `lookupUserId` usa `filter=email eq "x"`; o GoTrue trata `filter` como busca por trecho. Retry do órfão provavelmente nunca acha o usuário. | `apps/api/src/auth/supabase-provider.ts:233` |
| A5 | `/auth/verify` ativa **toda** linha com o email, em toda empresa e em qualquer status (reativa removido/bloqueado). | `apps/api/src/auth/reset.ts:56-59` |
| A6 | Trial sem `trial_ends_at`; nada aplica `expired`/`canceled` no acesso (o worker de cobrança já move para `canceled`, mas a API ignora). | `packages/db/src/provisioning/provision.ts:115`, `apps/api/src/auth/session.ts:155` |
| A7 | Signup não grava aceite de termos/privacidade (LGPD). | `apps/web/features/auth/components/SignupForm.tsx` |
| B1 | `POST /api/members` insere `invited` com `authUserId` aleatório. Sem token, email, auditoria, limite de plano. | `apps/api/src/routes/workspace/workspace.ts:157-204` |
| B2 | Toast "Convite enviado." é falso. | `MembersSection.tsx:42` |
| B3 | Sem página de aceite; troca de senha devolve 501 com Supabase. | `apps/api/src/routes/members/me.ts:119` |
| B5 | Sem reenviar/revogar/expirar convite; removido não pode ser reconvidado (409) nem reativado pela UI. | idem |
| B6 | `max_members` nunca aplicado. | `apps/api/src/services/platform/entitlements.ts` só usado no painel |
| B7 | OWNER pode convidar OWNER (doc `PERMISSIONS.md §7` proíbe). | `workspace.ts:168` |
| C1 | Sessão resolve membro por email, sem workspace: quem está em 2 empresas cai numa aleatória. | `packages/db/src/repos/index.ts:42` |

## 3. Decisões travadas

1. **Email do convite pelo Supabase** (mesmo canal de verify/reset; sem dependência do Postmark da F60-S04).
   - Pessoa **sem conta**: `auth.admin.inviteUserByEmail(email, { redirectTo: <app>/convite/<token> })` — template "Invite user".
   - Pessoa **com conta**: `auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: <app>/convite/<token> } })` — template "Magic link".
   - Fallback sempre disponível: admin **copia o link** do convite na tela de membros.
   - O que concede acesso é o **nosso token** (no path), não a sessão do Supabase que vem no fragmento.
2. **Várias empresas por pessoa entra agora.** Sessão = token do Supabase (`hm_session`) + empresa
   ativa (`hm_workspace`, id validado contra membership ativa a cada request). Membership é resolvida
   por `auth_user_id`, nunca por email.
3. **Trial de 15 dias** a partir do provisionamento.
4. **Fim do trial ou `canceled` = só leitura.** Leitura continua; escrita de usuário responde
   `402 { error: 'subscription_inactive' }`, exceto billing, auth, sessão e troca de empresa.
   Mensagens que chegam continuam sendo recebidas (sem perda de dado); **automações de saída**
   (agente IA, campanhas, passos de flow) pausam. `past_due` mantém acesso total com aviso.
5. **Sem auto-login** no aceite de convite de quem não tem conta (coerente com F44 §2.1): define a
   senha → vai para `/login` com email preenchido. Quem já tem conta e está logado aceita com um
   clique e a empresa vira a ativa.
6. **OWNER não entra por convite.** Convite aceita `ADMIN | SUPERVISOR | AGENT | READONLY` (papéis reais em
   `packages/shared/src/permissions.ts`); transferência de propriedade é outra feature.

## 4. Modelo de dados (F71-S01)

`member_invites` (RLS por `workspace_id`):

| coluna | tipo | nota |
|---|---|---|
| id | uuid pk | |
| workspace_id | uuid fk → workspaces, cascade | |
| email | citext not null | |
| role | text not null | check sem OWNER |
| department_id | uuid null fk → departments | opcional (PERMISSIONS §7) |
| token_hash | text not null unique | sha256 do token; o token em claro nunca é gravado |
| invited_by | uuid fk → members | |
| expires_at | timestamptz not null | 7 dias |
| accepted_at / revoked_at | timestamptz null | |
| accepted_member_id | uuid null fk → members | |
| last_sent_at, send_count | | reenvio com teto |
| created_at | | |

- Índice único parcial: um convite **pendente** por `(workspace_id, email)`.
- `members`: + `last_active_at` (empresa padrão no login), + `terms_accepted_at`, `terms_version`.
- Migração de dados: membros `status='invited'` com `invited_by not null` (os "convites" atuais com
  `authUserId` falso) viram linhas de `member_invites` pendentes e saem de `members`.
- Provisionador: `trial_ends_at = now() + 15 dias` em `workspaces` e `subscriptions`; idempotência por
  "esta pessoa (`auth_user_id`) já é OWNER de uma empresa criada por signup", não mais por email global.
- Backfill: empresas `trial` sem `trial_ends_at` recebem `now() + 15 dias`. **Antes do deploy, listar
  quais empresas reais isso atinge** (ver §8).

## 5. Contratos de API

Públicas (rate-limit por IP, respostas uniformes):

- `POST /auth/resend-verification` `{ email, turnstileToken }` → `200 { ok: true }` sempre.
- `POST /auth/login` → quando o provider diz "email não confirmado": `403 { error: 'email_unverified' }`
  (não conta para o captcha). Com várias empresas, escolhe `hm_workspace` (última usada).
- `GET /auth/invite/:token` → `200 { workspaceName, inviterName, role, emailMasked, hasAccount }` ou
  `404` uniforme (inválido, expirado, revogado ou já aceito).
- `POST /auth/invite/accept` `{ token, name?, password? }`
  - sem conta: `password` obrigatório → define senha, confirma email, cria member `active` → `200 { next: '/login?email=…' }`;
  - com conta: exige sessão cujo email = email do convite → cria member → seta `hm_workspace` → `200 { next: '/' }`.

Autenticadas:

- `GET /api/me` → inclui `memberships: { workspaceId, name, role }[]`.
- `POST /api/me/workspace` `{ workspaceId }` → valida membership ativa, seta `hm_workspace`, atualiza `last_active_at`.
- `GET /api/me/invites` → convites pendentes para o email da sessão (banner "você foi convidado").
- `PATCH /api/members/me/password` → deixa de ser 501 com Supabase.
- `GET|POST /api/members/invites`, `POST /api/members/invites/:id/resend`, `DELETE /api/members/invites/:id`,
  `GET /api/members/invites/:id/link` — gated por `member.invite`; `max_members` conta ativos + pendentes.
- `PATCH /api/members/:id { status: 'active' }` passa a ter UI (reativar).

## 6. Threat model

| # | Ameaça | Controle |
|---|---|---|
| T1 | Token de convite vazado/adivinhado | 32 bytes aleatórios, só hash no banco, expira em 7 dias, uso único, revogável |
| T2 | Aceitar convite com outra conta | Com conta: email da sessão = email do convite. Sem conta: o link chegou no email convidado |
| T3 | Enumeração por convite/reenvio | Respostas uniformes; reenviar confirmação sempre 200 |
| T4 | Escalada de papel | Sem OWNER por convite; papel vem do convite, nunca do body do aceite |
| T5 | Trocar para empresa alheia | `hm_workspace` só vale com membership `active` do `auth_user_id`; inválido cai na padrão |
| T6 | Reativar removido por verify | verify só promove a linha `invited` do dono, na empresa recém-provisionada |
| T7 | Burlar só-leitura | Guarda no servidor (middleware + workers), não só na UI |
| T8 | Spam de convite | Limite por empresa/hora, teto de reenvios por convite, `max_members` |
| T9 | Auditoria | `member.invited`, `member.invite_resent`, `member.invite_revoked`, `member.joined`, `workspace.switched` |

## 7. Slots

Ver `tasks/slots/F71/`. Ondas:

- **Onda 1:** S01 (schema) ‖ S02 (provider + runbook dos templates).
- **Onda 2:** S03 (sessão multi-empresa).
- **Onda 3:** S04 (cadastro completo, API) ‖ S05 (convites, API) ‖ S06 (trial e só leitura).
- **Onda 4:** S07 (UI de convite) ‖ S08 (seletor de empresa + aviso de assinatura) ‖ S09 (UI do cadastro).
- **Onda 5:** S10 (auditoria de segurança + teste de integração do fluxo inteiro).

## 8. Riscos e verificações fora do código

- **Template "Confirm signup" do Supabase (A1):** conferir no painel antes de qualquer coisa. Runbook na S02.
- **Redirect URLs do Supabase:** `<app>/convite/**` e `<app>/verify` precisam estar na allowlist.
- **SMTP do Supabase:** o SMTP embutido tem limite baixo de envio por hora; produção precisa de SMTP próprio configurado no projeto.
- **Backfill do trial:** empresas reais hoje em `trial` (ex.: clientes em operação) passariam a expirar em 15 dias. Rogério confirma a lista e estende pelo painel (`PUT /api/platform/tenants/:id/subscription`) antes do deploy.

## 9. Fora de escopo

- Admin da plataforma criar empresa/convidar dono (F67).
- Transferência de propriedade (OWNER).
- Email transacional próprio (Postmark) — F60-S04.
- Enforcement de outros limites de plano além de `max_members`.

## 10. Como ficou (pós-implementação)

Desvios da spec acima (S01–S09 integradas, validados pela jornada da S10 em
`apps/api/src/auth/accounts-journey.integration.test.ts`). Onde este capítulo e o §5 divergem, vale
este.

- **Preview é `POST /auth/invite/preview { token }`**, não `GET /auth/invite/:token`: o token nunca
  vai em path/query (access log do proxy, referrer). Responde `requiresEmailProof` no lugar de
  `hasAccount` (é o complemento exato: `true` = sem conta ou conta sem senha).
- **Prova de posse do email no aceite sem senha.** O token do convite deixou de ser suficiente
  (quem tivesse o link, inclusive o admin que o copiou, tomaria a conta): o aceite exige
  `emailProof { tokenHash, type: 'invite' | 'magiclink' }`, verificada no provider
  (`verifyEmailOwnership`). `403 email_proof_required` para ausente, inválida, usada ou de outro
  email. Novo `POST /auth/invite/send-email { token }` para quem chegou por link copiado.
- **A prova viaja no fragmento** (`#token_hash=…&type=…`) dos templates do Supabase; a página lê,
  limpa a URL com `history.replaceState`, guarda só em memória e manda no corpo. A página nunca
  consome a prova ao carregar (antivírus de email abrem links).
- **Link copiado é `POST /api/members/invites/:id/link`** (era `GET`): tem efeito (troca o token), então
  respeita view-as e só leitura; devolve `no-store`/`no-referrer`.
- **`POST /api/members` → `410`** com `replacement: '/api/members/invites'`; o convite antigo
  (linha `members.status='invited'`) é migrado ou aparece como `legacyInvite`.
- **Cotas de envio em Redis** (`invite-quota.ts`, script Lua atômico, fail-closed): 30/h por empresa,
  10/dia por destinatário (`sha256(email)`), 1/min e 5 por convite no envio público. Acrescentam-se
  ao teto de reenvio por convite. Redis fora: criação devolve `delivery: 'failed'` (o link segue
  copiável), reenvio e envio público respondem `503`.
- **Só leitura por guarda em `withRLS`** (`requireActiveSubscription`), não middleware global: todo
  router escopado por empresa passa por `requireAuth` + `withRLS`; GET/HEAD/OPTIONS passam;
  `/auth/**`, `/api/billing/**`, `/api/me/**` (inclui a troca de empresa), push, suporte e alguns
  `members/me` são exceções. `trial` com `trial_ends_at` no passado já vale `expired` antes do tick
  do worker. Workers de saída (agente, campanha, flow, lembrete) têm portão próprio. **Lacuna
  conhecida:** `/api/v1/**` (API key, sem `withRLS`) e o worker de outbound não passam pela guarda.
- **`/api/me` devolve `memberships[]`** (`workspaceId, name, slug, role, subscriptionStatus`, em
  ordem de uso) junto de `member` e `workspace` (que traz `subscriptionStatus` e `trialEndsAt`).
  `POST /api/me/workspace` responde com o mesmo payload; empresa inexistente e alheia dão o mesmo
  `404 workspace_not_found`.
- **Login escolhe a empresa por `last_active_at`**, ignorando o `hm_workspace` que o navegador já
  tinha (pode ser de outra pessoa).
- **Bloquear/remover membro revoga convites pendentes** do email na empresa; `member_blocked` (409)
  impede reconvidar bloqueado.
- **Aceite pelo banner não existe:** `GET /api/me/invites` não devolve token e o aceite exige o
  link do email; o banner explica onde está o link. Follow-up possível: `POST
  /api/me/invites/:id/accept` autenticado.
- **Rota ainda aberta:** pessoa com conta e sem nenhuma membership ativa não obtém sessão (login
  `403`), então não aceita pelo caminho "com conta". Decisão de produto pendente.
