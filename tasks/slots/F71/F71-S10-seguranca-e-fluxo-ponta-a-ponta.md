---
id: F71-S10
title: Auditoria de segurança da F71 e teste do fluxo inteiro de contas
phase: F71
status: review
priority: high
estimated_size: M
depends_on: [F71-S07, F71-S08, F71-S09]
blocks: []
source_docs:
  - docs/features/CONTAS_E_CONVITES.md
  - docs/security
agent_id: backend-engineer
claimed_at: 2026-10-07T01:33:15Z
completed_at: 2026-10-07T05:07:53Z

---
# F71-S10 — Segurança e fluxo ponta a ponta

## Objetivo

Provar que o fluxo inteiro funciona e que os controles do threat model (§6) seguram ataque de verdade.

## Escopo (faz)

- `/hm-security` focado em §6: token de convite, troca de empresa, só leitura, enumeração, RLS de `member_invites`, rate-limits, cookies e logs sem token nem senha. Cada achado com prova de conceito; corrigir o que for desta fase, e o que não for vira slot novo.
- Teste de integração da API (banco de dev real) cobrindo a jornada:
  1. signup → verify → login → empresa A ativa (trial de 15 dias);
  2. convidar B → aceite sem conta → login de B → B em A;
  3. B faz o próprio signup → tem A e a empresa própria → troca entre as duas;
  4. remover B de A → B não acessa mais A, segue na própria;
  5. trial de A vence (worker) → A só leitura → escrita 402, leitura 200.
- e2e do aceite de convite e da troca de empresa com a API mockada; atualizar `apps/web/e2e/fixtures/**`.
- Atualizar `docs/features/PERMISSIONS.md §7` (fluxo de convite real) e `docs/api-reference`, se as rotas estiverem documentadas lá.

### files_allowed

- `apps/api/src/**/*.integration.test.ts`
- `apps/api/test/**`
- `apps/web/e2e/**`
- `docs/features/PERMISSIONS.md`, `docs/features/CONTAS_E_CONVITES.md`, `docs/api-reference/**`, `docs/security/**`
- correções pontuais em arquivos da F71, com nota de correção no slot

## Definition of Done

- [ ] relatório de segurança em `docs/security/` com os achados e o que foi corrigido
- [ ] teste de integração da jornada verde
- [ ] e2e de convite e troca verde (ou roteiro manual registrado, se o host não aguentar)
- [ ] docs atualizados

## Validação

```bash
pnpm typecheck
pnpm lint
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/auth src/routes/workspace src/middlewares --maxWorkers=1
```

## Notas

- Agentes: `security-auditor` (auditoria) + `qa-engineer` (jornada e e2e).

## Notas de execução

### QA (jornada, e2e, docs) — o relatório de segurança em `docs/security/` é do auditor

- `apps/api/src/auth/accounts-journey.integration.test.ts` (6 `it` sequenciais, banco/Redis dev, app real + MockAuthProvider): signup com termos → verify → login → trial de 15 dias em `workspaces` e `subscriptions`; A convida B → aceite sem conta com a prova do outbox → B `active` em A com `authUserId` real e papel do convite; signup de B → duas empresas, `POST /api/me/workspace`, `memberships[]`, `hm_workspace`, dados isolados nos dois sentidos; remover B → cookie de A ignorado, convite pendente revogado ao bloquear, verify não reativa; trial de A vence pelo tick REAL `expireTrials` → 402 na escrita, 200 na leitura, billing e troca livres, empresa de B intacta; bordas (OWNER, expirado/revogado/reusado → 404 uniforme, prova de outro email → 403, `max_members` → 402).
- `apps/api/test/run-expire-trials.ts`: o tick roda em processo `tsx` próprio (o vite-node da API não carrega fontes de `apps/workers`); o teste do passo 5 tem timeout de 90 s por causa do cold start dos dois processos.
- e2e: `apps/web/e2e/specs/members-invites.spec.ts` (novo, 9: convidar, delivery failed, reenviar, reenvio esgotado, copiar link com clipboard e plano B manual, revogar, `seat_limit`, só leitura 402) e +1 em `workspace-switch.spec.ts` (trocar para empresa em só leitura). Fixture `api-mock.ts`: `/api/tags` e `/api/conversion-types` (o fallback `{}` derrubava `/settings` com `tags.length`).
- Docs: `PERMISSIONS.md §7` reescrito; `CONTAS_E_CONVITES.md §10`; `docs/api-reference` só documenta a API pública v1, nada a atualizar.
- Nenhum bug de código da F71 encontrado pela jornada; sem nota de correção.

### Correções da auditoria de fim de fase

Nota de correção (desvio de `files_allowed`): os arquivos de produção abaixo (e os testes ao lado) estão fora de `*.integration.test.ts`/docs; a edição foi autorizada pelo orchestrator para fechar os achados da auditoria. Nenhum exigiu `packages/**`.

- **F-01 (ALTO)** — API pública v1 respeita o modo só leitura. `services/api-keys.ts`: `lookupApiKey` faz `innerJoin` em `workspaces` e devolve `subscriptionStatus`/`trialEndsAt` no `ApiKeyAuth` (sem query extra). `middlewares/api-key.ts`: método fora de GET/HEAD/OPTIONS + `isSubscriptionInactive(...)` → `402 { error: 'subscription_inactive' }` antes do rate limit e de `req.apiAuth`. Teste: `routes/v1/routes.test.ts` (expired/canceled/trial vencido → POST 402 e GET 200; past_due/trial válido → POST 200).
- **F-02 (MÉDIO)** — worker outbound com portão de assinatura. `workers/src/outbound/worker.ts` (`subscriptionGate` injetável; dentro do lock, exceto `typing_indicator`: empresa inativa → `finalizeOutbound` com `errorCode: skipped_subscription_inactive`, `recordSubscriptionSkip`, ack, sem envio/retry); `lib/subscription-gate.ts` (`GatedWorker` + `'outbound'`, `allowAllSubscriptionGate` só para teste). Testes: `outbound/subscription-gate.test.ts` (novo); `outbound.test.ts`, `retry.test.ts`, `consent-gate.test.ts` e `calendar-reminders/reminders.outbox.test.ts` passaram a injetar o portão permissivo.
- **F-03 (MÉDIO)** — revalidação do socket. `socket/revalidate.ts` (`checkSocketSession`, `startSocketRevalidation`: timer de 60 s, `unref`, sem sobreposição, limpo no `disconnect`; derruba em `invalid`/outro membro; indisponibilidade não derruba), `socket/member-disconnect.ts` (seam `setMemberDisconnector`/`disconnectMemberSockets`, como o `support-realtime`), `socket/index.ts` (liga timer e registra `io.in('member:<id>').disconnectSockets(true)`), `routes/workspace/workspace.ts` (PATCH blocked/inactive e DELETE chamam `disconnectMemberSockets` após o commit). Teste: `socket/revalidate.test.ts` (fakes + fake timers).
- **F-07-adj (BAIXO) — REVERTIDO por decisão de produto** — a correção (não provisionar empresa para conta já confirmada) conflita com a spec travada (`CONTAS_E_CONVITES.md` §1 item 3 e F71-S01: "pessoa convidada em outra empresa que faz signup ganha a própria empresa") e derrubou os passos 3-5 da jornada. `auth/signup.ts` volta a provisionar também para conta confirmada (idempotência por `authUserId` OWNER do provisionador mantida; resposta e piso de tempo uniformes), com comentário no código: a empresa nasce `invited` e só ativa quando o dono confirma pelo verify, então o vetor de poluição é baixo. Testes ajustados (`auth/routes.test.ts`, `auth/flow.integration.test.ts`) para afirmar o comportamento da spec. Endurecimento encaminhado ao **F71-S19** (criar empresa própria autenticado; signup público de conta confirmada deixa de provisionar).
- **F-09 (BAIXO)** — `routes/members/me.ts`: `newPassword` usa `strongPassword`; `rateLimit({ bucket:'me_password', max:10, windowSec:900, byEmail:false })` (por IP) depois do guard de sessão. Teste: `routes/members/me-password.test.ts` (senha fraca → 400; 11ª tentativa → 429).
- **F-10 (BAIXO)** — `auth/routes.ts`: `signupIpLimiter` (`signup_ip`, 10/h, `byEmail:false`) antes do `signupLimiter`. Teste: `auth/routes.test.ts` (11º signup do mesmo IP → 429; outro IP não herda); o app de teste ganhou IP simulado por request. `flow.integration.test.ts` zera também o balde `signup_ip`.
- **F-13 (BAIXO)** — `middlewares/impersonation.ts`: anti-tamper por pessoa — busca a membership `adminMemberId` e exige `isPlatformAdmin`, `status = 'active'` e `authUserId === req.auth.identity.authUserId` (fail-closed); admin com a empresa ativa trocada não é mais trancado para fora. Testes: `impersonation.test.ts` (+2: empresa ativa trocada continua OK; membership que deixou de ser platform-admin → 403).
- **F-16 (BAIXO)** — `auth/invite.ts` + `routes/workspace/invites.ts` (`INVITE_AUDIT_ACTIONS.acceptDenied = 'member.invite_accept_denied'`): aceites negados (`login_required`, `wrong_account`, prova ausente/inválida/de outro email/de outra conta, `blocked_member`, `invite_conflict`) gravam `recordWorkspaceAudit` com `actorType:'system'`, metadata `{ reason, emailMasked }` (sem token/hash/prova/email completo), best-effort (falha de auditoria só vai ao log; resposta uniforme). Teste: `routes/workspace/invites.integration.test.ts` (asserções no fluxo "pessoa com conta").
- **F-18** — comentário do cabeçalho de `auth/invite.ts` corrigido: a prova viaja no FRAGMENTO (`/convite/<token>#token_hash=…&type=…`), nunca na query.

Pendência resolvida: os passos 3-5 da jornada (`accounts-journey.integration.test.ts`) voltam a valer com o revert do F-07-adj; o teste zera todos os baldes de rate limit de auth (incl. `signup_ip`, `reset`, `reset_confirm`, `resend`, `resend_ip`, `me_password`) para rodar estável junto com `flow.integration.test.ts`.
