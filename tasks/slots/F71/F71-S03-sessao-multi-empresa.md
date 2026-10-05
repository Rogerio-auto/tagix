---
id: F71-S03
title: Sessão por pessoa e empresa ativa — troca de empresa, login escolhe a última usada
phase: F71
status: done
priority: critical
estimated_size: M
depends_on: [F71-S01, F71-S02]
blocks: [F71-S04, F71-S05, F71-S06, F71-S08]
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
agent_id: backend-engineer
claimed_at: 2026-10-05T16:05:37Z
completed_at: 2026-10-05T16:26:40Z

---
# F71-S03 — Sessão por pessoa e empresa ativa

## Objetivo

Uma pessoa com membership ativa em várias empresas entra na última que usou e troca de empresa sem sair. A sessão é resolvida por `auth_user_id` e por empresa ativa, nunca por email.

## Contexto

C1 e A5 da spec. Login, `/api/me`, `requireAuth` e o handshake do socket usam `membersRepo.findByEmail`, que devolve uma linha qualquer. Spec §3.2 e §5.

## Escopo (faz)

- `session.ts`: `resolveSessionStatus(token, preferredWorkspaceId?)`:
  - identidade → `membershipsRepo.listActiveByAuthUser`;
  - empresa preferida, se for membership ativa; senão a de `last_active_at` mais recente;
  - nenhuma → `invalid`.
- Cookie `hm_workspace`: httpOnly, `SameSite=Lax`, `Secure` em prod, 30 dias. Só aceita UUID e é sempre revalidado; cookie de empresa sem membership é ignorado, não dá erro.
- Login (`routes.ts`):
  - usa membership por `authUserId`;
  - seta `hm_workspace` e atualiza `last_active_at`;
  - não emite cookie sem membership ativa (mantém F70-S28).
- `GET /api/me` devolve `memberships[]`.
- `POST /api/me/workspace { workspaceId }`:
  - valida membership ativa, seta o cookie e grava a auditoria `workspace.switched`;
  - é rejeitado sob impersonation (view-as).
- `requireAuth` e o handshake do socket passam a ler `hm_workspace`. As rooms do socket já são `ws:<id>` e seguem a empresa ativa.
- `verifyHandler` (`reset.ts`): promove para `active` **só** a linha `invited` do `authUserId` confirmado, nunca por email e nunca linhas `inactive`/`blocked` (A5).
- `PATCH /api/members/me/password` usa `updatePassword` do provider (fim do 501).
- `mock-provider.ts` deixa de usar `findByEmail`, se ainda usar; nenhum consumidor de `findByEmail` sobra em `apps/api`.
- Logout limpa `hm_workspace`.

## Fora de escopo

- UI do seletor (S08). Signup/resend (S04). Convites (S05).

### files_allowed

- `apps/api/src/auth/session.ts`, `apps/api/src/auth/session.test.ts`
- `apps/api/src/auth/routes.ts`, `apps/api/src/auth/routes.test.ts`
- `apps/api/src/auth/reset.ts`
- `apps/api/src/auth/index.ts`
- `apps/api/src/auth/mock-provider.ts`
- `apps/api/src/auth/flow.integration.test.ts`
- `apps/api/src/middlewares/auth.ts`
- `apps/api/src/middlewares/impersonation.ts`, `apps/api/src/middlewares/impersonation.test.ts`
- `apps/api/src/socket/**`
- `apps/api/src/routes/members/**`
- `apps/api/src/types/**` (augment do `req.auth`, se necessário)

### files_forbidden

- `packages/db/**` (S01), `apps/api/src/auth/signup.ts` (S04)

## Definition of Done

- [ ] teste: pessoa em 2 empresas → login cai na última usada; troca → requests seguintes na outra
- [ ] teste: `hm_workspace` de empresa sem membership → ignorado, cai na padrão
- [ ] teste: membership `inactive` numa empresa e `active` noutra → nunca resolve a inativa
- [ ] teste: verify não reativa member removido (A5)
- [ ] teste: troca de empresa sob view-as é rejeitada
- [ ] socket entra na room da empresa ativa (teste do handshake)
- [ ] troca de senha funciona com o provider Supabase (teste com provider mockado)
- [ ] zero uso de `membersRepo.findByEmail` em `apps/api/src` (grep no DoD)

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api lint
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/auth src/middlewares src/socket src/routes/members --maxWorkers=1
```

## Notas

- Agente: `backend-engineer`.
- O middleware do web (F70-S28) consulta `/api/me` repassando os cookies; conferir que `hm_workspace` segue junto.

## Notas de execução

- **Resolução de sessão por pessoa.** `resolveSessionStatus(token, preferredWorkspaceId?)`:
  `hm_workspace` só vale se for UUID **e** `membershipsRepo.findActive(authUserId, id)` devolver a
  linha; senão `listActiveByAuthUser(authUserId)[0]` (última usada) relida com `findActive`;
  nenhuma `active` → `invalid`. `authUserId` fora do formato UUID → `invalid` sem tocar o SQL.
  Custo com cookie válido: 2 consultas indexadas (igual ao antigo `findByEmail` + workspace).
  `req.auth` mantém o shape `{ identity, member, workspace }`; só o tipo `Member` passou a
  derivar de `membershipsRepo.findActive`.
- **Cookie `hm_workspace`** (`session.ts`, reexportado por `auth/index.ts`):
  `setActiveWorkspaceCookie(res, workspaceId): void` (httpOnly, SameSite=Lax, Secure em prod,
  path `/`, 30 dias; lança se o id não for UUID, porque gravar id não validado é bug) e
  `clearActiveWorkspaceCookie(res): void`. Leitura: `readPreferredWorkspace(req)` e
  `preferredWorkspaceFromHeader(header)` (só UUID passa). A S05 importa o setter de
  `apps/api/src/auth/session` depois de criar a membership `active`.
- **Login** escolhe sempre a empresa de `last_active_at` mais recente; o `hm_workspace` que o
  navegador já tenha não decide (pode ser de outra pessoa). Seta `hm_session` + `hm_workspace`,
  faz `touchLastActive` e devolve também `memberships[]`. Sem membership `active` → 403 sem
  cookie (F70-S28 mantido). Mapeamento de erros do provider intocado (o 403
  `email_unverified` é da S04).
- **`GET /api/me`** → `{ member, workspace, memberships: { workspaceId, name, slug, role,
  subscriptionStatus }[] }` (sem `memberId`/datas). Ordem = ordem de uso.
- **`POST /api/me/workspace { workspaceId }`** (montado no router de auth): Zod strict; sem
  membership `active` → 404 uniforme `workspace_not_found` (inexistente e alheia respondem
  igual); sob view-as ativa → 403 `impersonation_read_only`. O router de auth roda antes do
  middleware de impersonation, então a checagem é explícita via `hasActiveImpersonation(req)`
  (novo em `middlewares/impersonation.ts`; qualquer claim ativo recusa). Auditoria
  `workspace.switched` gravada na empresa de destino (`withWorkspace`, actor = membro de
  destino, metadata `{ fromWorkspaceId, toWorkspaceId }`) **antes** do cookie; troca para a
  própria empresa ativa não audita. Depois `touchLastActive` + cookie + payload de `/api/me`.
- **Logout** (`/auth/logout` e `DELETE /api/members/me/sessions/:id`) limpa `hm_workspace`.
- **`verifyHandler` (A5/T6):** promove só `members` com `auth_user_id` = id confirmado,
  `status='invited'`, `role='OWNER'` e `invited_by IS NULL` (o dono do signup). Nunca por email,
  nunca `inactive`/`blocked`, nunca linha de outra pessoa com o mesmo email.
- **Socket:** handshake extraído para `handshakeAuth` / `resolveHandshakeSession(cookieHeader)` /
  `sessionRooms(session)`; lê `hm_workspace` com as mesmas regras e entra em `ws:<empresa ativa>`.
  Erro inesperado no handshake agora recusa como `auth_unavailable` (antes a promise ficava sem
  `catch`). Teste novo `socket/handshake-session.test.ts` (sem `socket.io-client`, que não é dep
  do `@hm/api`: exercita o middleware `io.use` com um socket mínimo).
- **Mock provider:** sem `findByEmail`; o email só acha o `auth_user_id` (papel do diretório do
  GoTrue) numa consulta própria que prefere linha `active` e a empresa usada por último. O
  `verifyEmailToken` usa o mesmo caminho quando o processo reiniciou entre signup e clique.
- **Impersonation:** claim não-UUID agora é tratado como ausente (antes ia ao SQL e virava 500).
- **`routes/members/index.ts`:** `createMemberSubrouters()` é o ponto de montagem; `me.ts`
  (que o `app.ts` já monta) o monta no fim. A S05 adiciona ali `router.use(createInvitesMeRouter())`.
- **Troca de senha:** já corrigida na integração da S02 (`POST /api/members/me/password` →
  `updatePassword(authUserId)`, `false` → 502); conferida e coberta por `me-password.test.ts`.
  A spec cita `PATCH`, a rota real é `POST` (contrato do web).
- **Grep DoD:** `grep -rn findByEmail apps/api/src` → vazio.
- **Web (F70-S28):** `checkSession` do middleware manda só `hm_session` para `/api/me`. Não quebra:
  sem `hm_workspace` a API cai na empresa padrão e a validade da sessão não depende da empresa.
  As chamadas do navegador (rewrites, `credentials`) levam o `hm_workspace` normalmente.
- **Riscos para slots seguintes (fora deste escopo):**
  - O anti-tampering do view-as compara `req.auth.member.id` com `adminMemberId`; como o membro
    agora depende da empresa ativa, um admin de plataforma que abriu view-as numa empresa e
    está com outra ativa tem o claim recusado (fail-closed; a troca fica bloqueada durante o
    view-as). Avaliar na S10.
  - `is_platform_admin` é por linha de `members`: com a empresa ativa sem a flag, o painel de
    plataforma some para essa pessoa até trocar de volta. Decisão de produto para a S08/S10.

### Validação (2026-10-05)

- `pnpm --filter @hm/api typecheck` → ok.
- `pnpm --filter @hm/api lint` → o pacote não tem script `lint`; `npx eslint` nos 15 arquivos
  tocados → 0 problemas.
- `vitest run src/auth src/middlewares src/socket src/routes/members` → 15 arquivos, 206 testes,
  0 falhas (base antes do slot: 14 arquivos, 168 testes).
- Regressão extra (consumidores de sessão fora do escopo: app, conversations, dev, help,
  monitoring, org, platform, privacy, support, usage, workspace) → 22 arquivos, 210 testes, 0 falhas.
- `pnpm --filter @hm/web typecheck` → ok.
