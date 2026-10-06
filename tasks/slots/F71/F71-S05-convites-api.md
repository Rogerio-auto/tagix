---
id: F71-S05
title: Convite de verdade — criar, enviar, reenviar, revogar, copiar link e aceitar, com limite de membros
phase: F71
status: review
priority: critical
estimated_size: M
depends_on: [F71-S01, F71-S02, F71-S03]
blocks: [F71-S07]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/features/PERMISSIONS.md
agent_id: backend-engineer
claimed_at: 2026-10-05T17:11:26Z
completed_at: 2026-10-06T22:51:48Z

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

## Notas de execução

### Rotas (contrato final; a S07/S08 consomem)

Admin — `member.invite` (OWNER/ADMIN), empresa ativa da sessão, `invitesRepo` sob RLS:

- `GET /api/members/invites` → `200 { invites: PublicInvite[], seats: { used, limit|null } }`.
  `PublicInvite = { id, email, role, departmentId, invitedBy, createdAt, expiresAt, expired,
  lastSentAt, sendCount, resendsLeft }` (nunca token/hash; inclui vencidos para reenviar).
- `POST /api/members/invites { email, role, departmentId? }` (Zod strict) →
  `201 { invite, delivery: 'sent'|'failed' }`; convite vivo para o email →
  `200 { invite, delivery, resent: true }` (reenvia; papel do convite existente fica).
  Erros: `400 invalid_payload | owner_not_invitable | invalid_role | invalid_department`,
  `409 already_member`, `402 seat_limit { used, limit }`, `429 invite_rate_limited`
  (Retry-After 3600) e, no caminho de reenvio, `429 resend_cooldown | send_limit`.
- `POST /api/members/invites/:id/resend` → `200 { invite, delivery }`; `404 invite_not_found`
  (id malformado, alheio, aceito, revogado), `429 resend_cooldown` (Retry-After),
  `429 send_limit`, `429 invite_rate_limited`, `402 seat_limit` (só se o convite estava vencido).
- `DELETE /api/members/invites/:id` → `204`; `404 invite_not_found`.
- `GET /api/members/invites/:id/link` → `200 { url, expiresAt, invite }` + `Cache-Control:
  no-store`; troca o token (o link do email morre). `403 impersonation_read_only` sob view-as
  (é GET com efeito; o bloqueio de escrita do view-as não o pegaria), `404`, `402 seat_limit`
  (vencido sem assento), `503 link_unavailable` (prod sem `AUTH_EMAIL_REDIRECT_URL`/`APP_PUBLIC_URL`).
- `GET /api/members` passa a `member.invite` e devolve `legacyInvite: boolean` por membro.
- `POST /api/members` → `410 { error: 'gone', replacement: '/api/members/invites' }` (depois do
  guard: anônimo 401, sem permissão 403). Escolhido 410 e não delegar: o contrato antigo aceitava
  `name` e OWNER, devolvia `{ member }` e não mandava email; delegar manteria um segundo contrato
  com outra semântica e o cliente antigo leria um shape que não existe mais.
- `PATCH /api/members/:id { status: 'active' }` (reativação): `402 seat_limit` sem assento;
  `409 invite_pending` para linha `invited` (só aceite/verify a promovem — T6).

Públicas (`auth/invite.ts`, montadas no `app.ts` logo após o router de auth; rate-limit por IP:
preview 60/10min, aceite 20/15min; `Cache-Control: no-store`):

- `GET /auth/invite/:token` → `200 { workspaceName, inviterName, role, emailMasked, hasAccount,
  expiresAt }`; `404 { error: 'invite_not_found', message }` idêntico para malformado,
  inexistente, expirado, revogado e aceito; `503 auth_unavailable` (provider não responde).
- `POST /auth/invite/accept { token, name?, password? }` (strict; `role`/`workspaceId` → 400):
  - sem conta → `200 { next: '/login?email=<urlencoded>' }`, sem cookie; `400 password_required |
    weak_password` (`strongPassword` do signup), `502 account_update_failed`;
  - com conta → `200 { next: '/' }` + `Set-Cookie hm_workspace`; `401 login_required` (sem
    sessão), `403 wrong_account`, `403 impersonation_read_only`;
  - ambos: `404` uniforme (inclui perder a corrida do uso único), `409 invite_conflict`
    (`InviteAcceptConflictError`), `400 invalid_payload` sem ecoar nada.
- `GET /api/me/invites` (`routes/members/invites-me.ts`, `requireAuth`) → `200 { invites: { id,
  workspaceId, workspaceName, role, inviterName, expiresAt }[] }` pelo email da identidade;
  empresas em que a pessoa já é ativa saem. Não devolve token: o aceite é pelo link do email.

### "Tem conta" e anti-takeover

Classificação pelo email DO CONVITE com `findUserByEmail`: `account` = existe e `hasPassword`;
`claimable` = existe sem senha (nasceu do `sendInvite`); `none` = não existe. `hasAccount` do
preview = `account`.

- `account`: só com `hm_session` cuja identidade tem o email do convite e o mesmo
  `authUserId`; a senha do body é ignorada. Inclui cadastro **não confirmado com senha do
  dono**: se o link pudesse definir senha ali, quem tivesse o link (inclusive o admin que copiou)
  tomaria a conta, e o verify posterior do dono ativaria uma empresa cuja senha o invasor
  conhece. O dono confirma o email, entra e aceita logado.
- `claimable`: o link define a primeira senha (`completeAccount`, que confirma o email).
  `emailConfirmed` não serve de critério: o link "Invite user" do Supabase confirma o email ao
  ser clicado, então o convidado que abriu o email fica confirmado sem senha.
- `none` (envio falhou, admin copiou o link): `signUp` + `completeAccount`. `signUp` que acha
  conta existente reclassifica e só segue se ainda for `claimable`. No Supabase o `signUp`
  dispara o email de confirmação; clicar depois é inócuo.
- Sessão do aceite: `verifyTokenResilient` (identidade), não `resolveSessionStatus`, para quem
  tem sessão mas foi removido da empresa ativa entre o login e o aceite.

### Limites

`max_members` = ativos + convites vivos (chave ausente = ilimitado), conferido DEPOIS de gravar
o convite (revoga se estourou: corrida nunca deixa acima do teto). 30 envios/hora por empresa
contados em `audit_logs` (`member.invited` + `member.invite_resent`, índice
`idx_audit_logs_workspace_created`). Reenvio: 1/min (`last_sent_at`) e 6 envios no total
(1 + 5 reenvios), teto atômico no `recordResend`. Cooldown e limite/hora são check-then-act
(corrida limitada ao paralelismo de um admin).

### Auditoria

`member.invited`, `member.invite_resent`, `member.invite_revoked`, `member.invite_link_copied`,
`member.joined` em `audit_logs` com `workspace_id`, `resource_type='member_invite'`,
`resource_id` = convite; metadata com email/papel/entrega, nunca token nem hash (testado).
Gravadas logo depois da mutação do repo, em outra transação (o repo abre a própria).

### Fora do `files_allowed` (1 linha)

`apps/api/src/middlewares/uuid-params.ts`: `'invites'` em `NON_UUID_LITERALS`. Sem isso o guard
de UUID (que roda antes de todas as rotas `/api/*` com sessão) respondia 404 a
`/api/members/invites` inteiro, porque `members` está em `ID_AFTER`. É o ponto de extensão
documentado do guard; nenhum slot em paralelo mexe nele. O teste de integração monta o guard.

### Riscos para S07/S08/S10

- Pessoa **com conta e sem nenhuma membership ativa** (removida de todas, ou dono de signup
  nunca verificado) não consegue sessão (login → 403 sem cookie, F70-S28), logo não aceita pelo
  caminho `account`. Decisão para a S10: login emitir sessão "sem empresa" para quem tem convite
  vivo, ou aceite com reautenticação por senha (com captcha).
- `claimable` + copiar link: o admin que copia o link pode definir a primeira senha de uma conta
  que só existe por convite (inerente ao fallback do §3.1; nunca toca conta com senha do dono).
  O dono real recupera por "esqueci a senha".
- `GET /auth/invite/:token` leva o token no path: o access log do proxy (Traefik) pode gravá-lo.
  Conferir na S10 que o access log não registra o path dessa rota (ou trocar o preview para POST).
  A página `/convite/<token>` da S07 precisa de `Referrer-Policy: no-referrer`.
- Banner da S08: `/api/me/invites` não permite aceitar sem o link; se o produto quiser aceitar
  pelo banner, um `POST /api/me/invites/:id/accept` (sessão de conta confirmada = prova da
  caixa) é seguro.

### Validação (2026-10-05)

- `pnpm --filter @hm/api typecheck` → ok.
- `pnpm --filter @hm/api lint` → o pacote não tem script `lint`; `npx eslint` nos 12 arquivos
  tocados → 0 problemas.
- `vitest run src/routes/workspace src/auth/invite.test.ts src/routes/members` → 6 arquivos,
  55 testes, 0 falhas (integração: 15 testes contra o Postgres dev com o MockAuthProvider).
- Regressão: `src/middlewares src/auth src/socket` → 17 arquivos, 265 testes; `app.test.ts`,
  `routes/org`, `routes/audit`, `routes/platform` → 13 arquivos, 117 testes; 0 falhas.

### Correções pós-auditoria (2026-10-05)

A auditoria de segurança pré-merge reprovou a primeira versão (A1 alto; B1–B6). Esta seção
**substitui** os contratos e decisões acima onde houver conflito (preview por GET, `hasAccount`,
aceite `none` com `signUp`, limite/hora em `audit_logs`, link por GET).

#### Desenho final (A1 — prova de posse da caixa)

Duas provas distintas: o **token do convite** (caminho `/convite/<token>`) prova "tenho o link"
— o admin também o tem pelo "copiar link"; o **`token_hash` do Supabase** (FRAGMENTO do link
do email) prova "li este email" e o admin nunca o vê. Criar senha (casos `claimable`/`none`)
exige as duas. Os templates "Invite user" e "Magic link" passam a linkar
`{{ .RedirectTo }}#token_hash={{ .TokenHash }}&type=invite|magiclink` (runbook atualizado; o
fragmento substituiu a query no ajuste M1, abaixo).

- Provider: novo `IAccountAuthProvider.verifyEmailOwnership(tokenHash, type: 'invite' |
  'magiclink'): Promise<AuthIdentity | null>` (`@hm/shared`, + `EMAIL_PROOF_TYPES` /
  `EmailProofType`). Não reutilizei `verifyEmailToken`: tipo fixo, o mock lê o email do próprio
  token (a `/verify` depende disso) e o real usa o cliente auth-js compartilhado, que guarda a
  sessão em memória do processo.
  - Supabase: `fetch` direto em `POST /auth/v1/verify { type, token_hash }` com a anon key;
    `invite` → GoTrue `invite`; `magiclink` → GoTrue `email` (o `magiclink` está deprecado; `email`
    procura o hash no token de confirmação OU de recuperação). Lê só `user.id/email` e revoga a
    sessão criada (`POST /auth/v1/logout?scope=local`, best-effort). 4xx → `null`; rede/429/5xx →
    `AuthError('provider_error')`; hash fora de `[A-Za-z0-9_-]{8,256}` nem sai para a rede.
  - Mock: cada envio grava um `token_hash` aleatório (outbox ganhou `tokenHash`, `proofType` e
    `link` = URL do botão); aceito uma vez, do mesmo tipo; envio novo para o mesmo endereço
    invalida o anterior; verificar confirma o email (paridade com o GoTrue).
- Aceite `claimable`/`none`: exige `emailProof`; senha validada ANTES de consumir a prova (uso
  único); prova inválida/usada/de outro email/de outra conta → `403 email_proof_required` (corpo
  único). Reclassifica depois da prova: conta com senha → `401 login_required`; só segue se
  `claimable` com o mesmo `authUserId` da prova. O caminho `none` **não chama mais `signUp`**:
  a conta nasce do `sendInvite` (sem senha) disparado por `send-email` e só o dono da caixa a
  completa.
- `requiresEmailProof` substitui `hasAccount` no preview: é exatamente o complemento
  (`kind !== 'account'`), então não vaza nada além do que já vazava. Estados da UI (S07):
  `requiresEmailProof=false` → "entre com a sua conta e aceite"; `true` + `token_hash`/`type`
  no fragmento → "crie a sua senha" (manda `emailProof`); `true` sem eles → "enviar o convite
  para o seu email" (`send-email`). **A página nunca verifica o `token_hash` ao carregar**
  (antivírus de email clicam nos links); só o envio do formulário o consome.
- **Contrato da página `/convite/[token]` (S07) com a prova (M1):** ao montar, lê
  `location.hash` (`URLSearchParams(location.hash.slice(1))` → `token_hash`, `type`), guarda os
  dois só em memória (estado do componente; nada de storage) e chama **imediatamente**
  `history.replaceState(null, '', location.pathname)` para limpar o fragmento (sai do
  histórico, da barra e de um "copiar URL"). No submit do formulário de senha envia
  `emailProof: { tokenHash, type }` no corpo do `POST /auth/invite/accept`. Nunca lê
  `token_hash` da query, nunca o loga, nunca o envia em URL. A API não mudou: já recebia
  `emailProof` no corpo.

#### Contratos HTTP finais

Públicas (`apps/api/src/auth/invite.ts`; token SEMPRE no corpo; toda resposta com
`Cache-Control: no-store` e `Referrer-Policy: no-referrer`; rate-limit por IP):

- `POST /auth/invite/preview { token }` (60/10 min) → `200 { workspaceName, inviterName, role,
  emailMasked, requiresEmailProof, expiresAt }`. `404 { error: 'invite_not_found', message }`
  idêntico para corpo inválido, token malformado, inexistente, expirado, revogado, aceito.
  `503 auth_unavailable`. O `GET /auth/invite/:token` foi removido.
- `POST /auth/invite/send-email { token }` (5/15 min) → `200 { ok: true, emailMasked }` para
  token vivo, exista a conta ou não e mesmo se o provider falhar (vai para o log). Manda o
  email ao endereço DO convite com o MESMO token (não troca) + prova. `404` uniforme.
  `429 send_cooldown` (Retry-After real, 1/min por convite) | `429 send_limit` (Retry-After 3600;
  teto de 5 por convite em 7 dias, ou cota da empresa/destinatário). `503 send_unavailable`
  (Redis fora). Auditoria `member.invite_email_requested` (`actor_type='system'`).
- `POST /auth/invite/accept { token, name?, password?, emailProof?: { tokenHash, type:
  'invite'|'magiclink' } }` (strict; 20/15 min):
  - conta com senha → exige `hm_session` do email e conta do convite → `200 { next: '/' }` +
    `Set-Cookie hm_workspace`; `401 login_required`, `403 wrong_account`,
    `403 impersonation_read_only`. `password`/`emailProof` ignorados.
  - sem senha (`claimable`/`none`) → `200 { next: '/login?email=<urlencoded>' }`, sem cookie;
    `403 email_proof_required` (sem prova ou prova inválida/usada/de outro email/outra conta),
    `400 password_required | weak_password` (antes de consumir a prova), `401 login_required`
    (a conta ganhou senha), `502 account_update_failed`.
  - ambos: `404` uniforme (inclui perder a corrida do uso único), `409 invite_conflict`
    (membro bloqueado nesta empresa — B6 — ou `InviteAcceptConflictError`),
    `400 invalid_payload` sem ecoar nada, `503 auth_unavailable`.

Admin (`member.invite` = OWNER/ADMIN, empresa ativa da sessão, sob RLS):

- `GET /api/members/invites` → `200 { invites: PublicInvite[], seats: { used, limit|null } }`.
- `POST /api/members/invites { email, role, departmentId? }` → `201 { invite, delivery:
  'sent'|'failed' }`; convite vivo para o email → `200 { invite, delivery, resent: true }`.
  Erros: `400 invalid_payload | owner_not_invitable | invalid_role | invalid_department`,
  `409 already_member`, `409 member_blocked` (novo, B6), `402 seat_limit { used, limit }`,
  `429 invite_rate_limited` (Retry-After 3600; só o teto da EMPRESA; o convite gravado é
  revogado), e no caminho de reenvio `429 resend_cooldown | send_limit`,
  `503 invite_quota_unavailable`. Teto do DESTINATÁRIO estourado ou Redis fora na criação →
  convite fica, `201 { invite, delivery: 'failed' }` (o admin copia o link; ajuste L2).
- `POST /api/members/invites/:id/resend` → `200 { invite, delivery }`; `404 invite_not_found`,
  `429 resend_cooldown` (Retry-After), `429 send_limit`, `429 invite_rate_limited`,
  `402 seat_limit` (vencido sem assento), `503 invite_quota_unavailable`.
- `DELETE /api/members/invites/:id` → `204`; `404 invite_not_found`.
- `POST /api/members/invites/:id/link` (era GET) → `200 { url, expiresAt, invite }` + `no-store` +
  `no-referrer`; troca o token. Bloqueado pelo view-as (`403 impersonation_read_only`, middleware)
  e pelo só leitura (`402 subscription_inactive`, guard) — o check ad hoc saiu. `404`,
  `402 seat_limit`, `503 link_unavailable`.
- `:id` malformado em `/api/members/invites/:id/*` → 404 central (guard de UUID).
  `PATCH/DELETE /api/members/invites` e `PATCH/DELETE /api/members/<não-uuid>` → `404`.
- `PATCH /api/members/:id { status: 'blocked'|'inactive' }` e `DELETE /api/members/:id` agora
  revogam os convites pendentes do email do membro na empresa (auditoria
  `member.invite_revoked`, metadata `reason: 'member_blocked'|'member_removed'`).
- `GET /api/me/invites` (inalterado) → `200 { invites: { id, workspaceId, workspaceName, role,
  inviterName, expiresAt }[] }`, `no-store`.

#### Achados

- **A1** — acima. Arquivos: `auth/invite.ts`, `auth/{supabase-provider,mock-provider}.ts`,
  `packages/shared/src/auth/index.ts`, `routes/workspace/invites.ts` (`deliverInviteEmail`
  exportado), runbook.
- **B1** — mantida a ordem `completeAccount` → claim atômico. Inverter exigiria compensar
  (desfazer `accepted_at` e o member criado/reativado sem saber o status anterior), o que não é
  possível sem mexer em `packages/db`. Com A1 só o dono da caixa chega ao `completeAccount`, e
  antes dele rodam o check de bloqueado e a reclassificação. **Risco residual:** se o claim
  falhar depois (corrida com outro aceite, revogação no meio, `InviteAcceptConflictError`), a
  conta fica com a senha que o PRÓPRIO dono escolheu e sem a empresa — nunca senha de
  terceiro. Sem membership ativa, ele não consegue sessão (mesmo risco já listado para a S10).
- **B2** — `routes/workspace/invite-quota.ts`: script Lua atômico no Redis (checa todos os
  tetos e só então incrementa; recusa não gasta cota). Empresa 30/h; destinatário
  `sha256(email)` 10/24 h somando empresas (um convite gasta no máximo 6 envios; 2–3 empresas
  no mesmo dia cabem; acima disso é abuso, e errar custa pouco — o link copiável segue
  funcionando); link público 1/min e 5 por convite em 7 dias. Consumido ANTES do envio;
  devolvido se o `recordResend` falhar. Revogar + recriar não zera (chaves não dependem do
  convite). Cliente Redis próprio do módulo (mesmo `loadConfig().redisUrl` e opções do
  `rate-limit.ts`, que não exporta o cliente). Fail-closed: Redis fora → criação sem email,
  reenvio/envio público 503.
- **B3** — preview virou `POST /auth/invite/preview { token }`. `observability/sentry.ts`:
  `beforeSend`, `beforeSendTransaction` e `beforeBreadcrumb` mascaram `/auth/invite/<x>`
  (menos as rotas literais), `/convite/<x>` (também url-encoded), `token_hash`, `redirect_to` e
  `token` em query ou fragmento, chaves sensíveis no corpo (`token`, `password`, `tokenHash`,
  `emailProof`…), os headers `authorization`/`cookie` e `request.cookies` (removido inteiro,
  ajuste L5); vale para url, query, headers, corpo, transação, mensagem, exceções e
  breadcrumbs. Rotas públicas com `no-store` + `no-referrer`.
- **B4** — `uuid-params.ts`: `'invites'` saiu de `NON_UUID_LITERALS`; `'members/invites'` entrou
  em `ID_AFTER_NESTED`. `workspace.ts` valida `:id` UUID em PATCH/DELETE (404).
- **B5** — link virou POST; check ad hoc de view-as removido (o middleware de impersonation
  bloqueia não-GET; o guard de assinatura bloqueia escrita fora da allowlist).
- **B6** — aceite com membro `blocked` (por email ou `authUserId`) → `409 invite_conflict`
  antes de qualquer efeito; convidar email bloqueado → `409 member_blocked`; bloquear/remover
  revoga os pendentes com auditoria (`revokePendingInvitesFor`).

#### Fora do `files_allowed` (autorizados pelo orchestrator para esta correção)

`apps/api/src/observability/sentry.ts` (+ teste), `apps/api/src/auth/{supabase-provider,
mock-provider}.ts` + `provider.test.ts`/`supabase-provider.test.ts`,
`packages/shared/src/auth/index.ts`, `docs/runbooks/supabase-auth-emails.md`,
`apps/api/src/middlewares/uuid-params.test.ts`. Novos dentro de `routes/workspace/**`:
`invite-quota.ts` + `invite-quota.test.ts`. `app.ts` não mudou nesta correção.
`packages/db` intocado (o comentário de `InviteLookup` ainda cita `GET /auth/invite/:token`).

#### Pendências humanas / outros slots

- **Painel do Supabase (humano):** trocar os templates "Invite user" e "Magic link" para os
  links com `#token_hash` no FRAGMENTO (runbook §4.3/§4.4) ANTES de liberar convites em
  produção. Sem isso, convidado sem conta não consegue criar a senha (só quem já tem conta
  aceita). Com `?` em vez de `#`, a prova vaza para logs (M1).
- **S07:** consumir `requiresEmailProof`; ler `token_hash`/`type` de `location.hash`, limpar o
  fragmento com `history.replaceState` ao carregar e só enviá-los no submit (`emailProof`);
  página `/convite` com `Referrer-Policy: no-referrer`; copiar link via POST; `delivery:
  'failed'` na criação → oferecer "copiar link" (vale também para o teto por destinatário).
- **Melhoria registrada (fora deste slot):** "Reset password" ainda leva `?token_hash=` na
  query (credencial de redefinição em log de acesso). Migrar `/reset-password` (e `/verify`)
  para fragmento exige mudar a página e o template no mesmo deploy.
- **S10:** C1 (oráculo de `requiresEmailProof`), C2 (email no `next`), C3 (corrida de assento
  na reativação), C4 (auditoria de aceites negados); o risco de B1; conferir se o GoTrue manda
  "Confirm signup" em vez de "Magic link" para conta não confirmada (runbook §5.4 passo 5).

#### Ajuste final pré-merge (re-auditoria, 2026-10-05)

- **M1 (médio)** — `token_hash` na query ia para access log do proxy/Next, histórico e
  Referer; o de `magiclink` dá login via `/auth/v1/verify` por 24 h e, junto com
  `/convite/<token>` da mesma linha de log, reabria o A1. Templates "Invite user" e "Magic
  link" agora usam FRAGMENTO (`{{ .RedirectTo }}#token_hash=…&type=invite|magiclink`): o
  navegador não o manda ao servidor nem no Referer. Runbook reescrito (topo "Por que
  fragmento", §4.3, §4.4, §5.3 com passo de log, §5.4, checklist, tabela de problemas). Mock:
  o `link` do outbox monta a prova em `URL.hash`; testes do mock e da integração leem o
  fragmento e afirmam `search === ''`. Sentry: o mascaramento de `token_hash`/`token`/
  `redirect_to` também cobre `#…`. API inalterada (`emailProof` já vinha no corpo).
- **L2 (baixo)** — teto POR DESTINATÁRIO na criação não revoga mais o convite: `201 { invite,
  delivery: 'failed' }` (mesma resposta do Redis fora; não revela que outra empresa convidou),
  o convite fica pendente e o admin copia o link. Uma empresa hostil que esgota os 10/dia de
  uma caixa não impede as outras de convidar. Teto POR EMPRESA segue `429` + revogação.
  Reenvio e envio público mantêm o comportamento (não criam convite).
- **L5 (baixo)** — `scrubSentryEvent` (usado em `beforeSend` e `beforeSendTransaction`) remove
  `event.request.cookies` (defesa em profundidade; `sendDefaultPii: false` já os omitia).

#### Validação (2026-10-05, pós-correção)

- `pnpm --filter @hm/shared typecheck`, `@hm/api typecheck`, `@hm/web typecheck` → ok.
- `npx eslint` nos 22 arquivos tocados → 0 problemas.
- `vitest run src/routes/workspace src/auth src/routes/members src/middlewares
  src/observability --maxWorkers=1` → 22 arquivos, 323 testes, 0 falhas (integração de
  convites: 18 testes contra o Postgres/Redis dev com o MockAuthProvider). `src/app.test.ts` → ok.
- Ajuste final pré-merge (M1/L2/L5): `pnpm --filter @hm/api typecheck` → ok; `npx eslint` nos
  6 arquivos de código tocados → 0 problemas; `vitest run src/routes/workspace src/auth
  src/routes/members src/middlewares src/observability --maxWorkers=1` → 22 arquivos, 325
  testes, 0 falhas.
