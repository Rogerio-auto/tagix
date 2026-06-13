
## F6 wave 1 — dispatch (orchestrator)
- F6-S01 [db] schema campaigns (7 tabelas + scheduled_followups + idempotency UNIQUE + RLS) → db-engineer
- F6-S02 [channels] meta errors map + quality/template helpers → backend-engineer
- Paralelos: pacotes disjuntos (@hm/db vs @hm/channels), zero overlap em files_allowed.
- Integração 1-por-vez via stash dance; S01 antes (S02 não depende de S01 mas S03/S05 dependem de ambos).

## F7 wave 1 — dispatch (orchestrator) 2026-06-11
- F7-S01 [db] schema calendar (5 tabelas: calendars/availability_rules/availability_exceptions/events/event_participants) + funcao PL/pgSQL `compute_available_slots` (DATA_MODEL §12.6 / CALENDAR.md §3.1, com buffer/min_notice/timezone) + RLS → db-engineer.
- Gate de toda a F7 (S02..S07 dependem dele direta ou transitivamente). Despachado SOLO (sem paralelo).
- Branch canonica: feat/f7-s01 (claim ja feito pelo orchestrator).
- event_participants NAO tem workspace_id proprio → RLS via subquery em events (espelha agent_tools/campaign_steps).
- Migration: drizzle-kit generate p/ as 5 tabelas (0030) + migration custom SQL (0031) com a funcao + RLS. Validar contra Postgres real (member com rules + 1 excecao + 1 evento conflitante → 3 filtros).

## F15 (Instagram channel completion) — dispatch (orchestrator) 2026-06-12
Grafo: S01 ─┬ S02 ─ S03 ─┐; ├ S04 ┴ S05 ─ S08; └ S06 ─ S07. S09 (docs) ∥ desde o início.
- **Wave 1**: F15-S01 (IG adapter completo, channels, critical) + F15-S09 (docs App Review/opt-out/redact, general-purpose). Disjuntos (packages/channels vs docs/runbooks).
- DECISÃO de fronteira: o canonical `OutboundJob` discriminated union vive em `apps/workers/src/outbound/job.ts` (Zod), NÃO em `packages/channels/src/types.ts`. S01 NÃO toca o worker. S01 adiciona ao `IChannelAdapter` as assinaturas de comment actions (sendPrivateReplyToComment/replyPublicToComment/hideComment/deleteComment) + input types IG no `types.ts`. A extensão da union `OutboundJob` (kinds ig_private_reply/ig_public_reply/ig_hide_comment) é de F15-S04 (owns apps/workers/src/outbound/**). Evita colisão cross-slot.
- Workers NÃO rodam git/slot.py/commit/pnpm install/pnpm build. Integração e wire são do orchestrator (stash-dance 1-a-1 ao fechar a onda).

## F15 wave 2 — dispatch (orchestrator) 2026-06-12
S01 done → desbloqueia S02, S04, S06 (paralelos, paths disjuntos: api/webhooks vs workers/outbound vs api/channels).
- F15-S02: webhook IG. ACHADO: meta.ts JÁ roteia object:'instagram' (providerForObject) + dedup provider-aware + publishInboundMessage compartilhado + deriveEventId já cobre mid/comment id. event-id.ts/dedup.ts/signature.ts são PROIBIDOS no slot. → S02 isola o parsing/roteamento IG num módulo dedicado `meta-instagram.ts` (extractIgEventSummaries) + teste de ingestão IG; meta.ts segue magro (já montado, sem wire novo).
- F15-S04: ramo IG do dispatchOutbound + janela 24h/MESSAGE_TAG + extensão da union OutboundJob (kinds ig_*) em apps/workers/src/outbound/job.ts.
- F15-S06: ramo IG do connect (channels routes) — lista Page/IGBA, valida Business/Creator, subscribe webhook, cria channel + cifra token, test message. Exporta handlers; wire de app.ts é do orchestrator (se necessário).
- Executor único no harness (Task tool indisponível): orchestrator implementa cada slot na sua branch e integra. Paths disjuntos garantem zero colisão.

## F15 wave 2 — integrado (orchestrator) 2026-06-12
S02/S04/S06 done e em main. LIÇÃO: `vitest run <file>` NÃO typecheca; rodar `pnpm --filter <pkg> typecheck` ANTES do finish (S06 mergeou com erro de tuple-type no test → hotfix 1 commit em main). Daqui pra frente: typecheck do pacote sempre antes de finish.
- S03 (inbound persistence) desbloqueado (deps S01+S02 done). S05 espera S03+S04. S07 espera S06. S08 espera S05.
- Próxima onda: S03 (solo, workers/inbound) → depois S05 (api) + S07 (web) podem ir; S08 após S05.

## F15 wave 3/4 — integrado (orchestrator) 2026-06-12
S03 (inbound IG: parser real wired + story/share/postback/referral->messages + comments->ig_comments+comment_thread + metrica hm.ig.messages.received) e S05 (comments API + wire app.ts) done em main.
- DESVIO de permissão S05: não há permission key dedicada de IG e `@hm/shared` está fora do files_allowed. Mapeei: list=conversation.view, reply(pub/priv)=conversation.assign (STAFF respondem), hide/delete=conversation.delete_message (ADMINS). Supervisor NÃO modera hide/delete (delete_message é OWNER/ADMIN). Follow-up honesto: criar perms ig.comment.* em fase futura se quiser supervisor moderando.
- FOLLOW-UP S05: DELETE de comment é soft (marca ig_comments.hidden + audit ig.comment.delete); a exclusão DURA na Graph precisa de um kind ig_delete_comment no worker outbound (S04) — deferido (adapter.deleteComment já existe, só falta o dispatch kind).
- Próxima onda (final): S07 (connect wizard, web/settings/channels) + S08 (inbox UI, web/conversations) — disjuntos. NENHUM worker roda pnpm build (colide .next); orchestrator faz o build autoritativo na integração.

## F15 — COMPLETA 9/9 (orchestrator) 2026-06-12
Todos os 9 slots done, integrados, verdes em main. Validacao final:
- pnpm typecheck: verde (13 projetos). pnpm lint: verde. pnpm -r test: verde (channels 67, workers 173, api 227, db 20, flow-engine 44, agents-core 26, ui 6, agents-client 17, storage 1). pnpm --filter @hm/web build: verde (21 paginas).
- pnpm audit --audit-level high: 1 high = esbuild (transitivo via tsx/vitest/vite, DEV-ONLY, nao-shipado). PRE-EXISTENTE — F15 nao adicionou nenhuma dependencia (zero package.json mudou). Nao e regressao da fase.
- WIRE feito: meta.ts (IG summary log, S02 — sem router novo), app.ts (createInstagramRouter, S05), parse.ts+worker.ts inbound (parseInstagramWebhook real, S03). createOutboundDeps já liga meta_instagram via adapter-factory existente.
- DESVIOS/path: S07 escreveu em apps/web/features/channels/** (o wizard real vive ai; o files_allowed do slot apontava settings/channels/** que nao existe). S05 permissions reusam conversation.* (sem perm ig.* nova — @hm/shared fora do escopo).
- FOLLOW-UPS honestos: (1) envio E2E real exige conta IG Business + App Review aprovada (runbook em docs/runbooks/meta-app-review-instagram.md). (2) DELETE de comment e soft (DB hidden+audit); hard-delete na Graph precisa de kind ig_delete_comment no worker outbound. (3) S08: IgCommentActions consome message.metadata.{mediaId,commentId} — o GET de mensagens precisa expor esses campos para a moderacao por-comment ficar 100% no thread (hoje degrada sem eles). (4) perms ig.comment.* dedicadas se quiser supervisor moderando.

---

## F25 — Super-admin de IA (orchestrator, 2026-06-12)

Harness sem Task/Write/Edit/Agent → atuo como **executor único** (shell), respeitando `files_allowed` de cada slot e integrando via stash-dance.

Contexto verificado antes de despachar:
- Schema 100% ready: `llm.ts` (llmUsageLogs RLS + llmModelsWhitelist GLOBAL), `platform_secrets.ts`, `agents.ts` (workspaceAgentPolicies PK=workspace_id), `audit_logs` (actor_type já aceita 'platform_admin').
- `getDb()` = conexão owner SEM `set local role hm_app` → ideal p/ queries cross-workspace de plataforma (sem RLS de tenant). `withWorkspace()` é só p/ tenant.
- crypto: `encryptSecret/decryptSecret` exportados de `@hm/db` (AES-256-GCM, ENCRYPTION_KEY).
- Sessão expõe `member.isPlatformAdmin` (publicMember + `GET /api/me`). Guard frontend (S06) chama `/api/me` server-side (getServerSession é stub sem isPlatformAdmin).
- Tests da api batem Postgres dev real (infra up, healthy).

**Onda 1 disparada:** S01 (guard, critical), S06 (shell frontend), S09 (runbooks). Disjuntos.

### Desvio S06 (route group): URL `/platform/*` para evitar colisão de root
`(app)/page.tsx` já resolve `/`. Um `(platform)/page.tsx` no root do grupo resolveria `/` também → erro Next "two parallel pages resolve to same path". As nav-items do painel já apontam `/platform/*`. Decisão: home do painel fica em `app/(platform)/platform/page.tsx` (URL `/platform`), layout do grupo em `app/(platform)/layout.tsx` (aplica a tudo sob o grupo). Consequência p/ S07/S08: as páginas ficam em `app/(platform)/platform/{models,policies,secrets,usage}/` (URLs `/platform/...`), não em `app/(platform)/{models...}`. Ajuste necessário vs. files_allowed literal — a colisão de root é constraint duro.

### Onda 3 (S07 Modelos/Politicas + S08 Secrets/Uso) — gotchas
- **Barrel client-safe:** `features/platform-admin/lib/index.ts` NAO reexporta `guard.ts` (server-only, next/headers). Client components importam o barrel; o layout server importa `./guard` direto. Senao o build quebra ("importing next/headers in a Client Component").
- **LlmModel pricing e number|null** (a API S02 serializa numeric->number), nao string.
- **WasmHash crash no build:** `next build` morreu com "Cannot read properties of undefined (reading 'length')" em WasmHash._updateWithBuffer (cache webpack stale, Node 24). Fix: `rm -rf apps/web/.next/cache` e rebuildar. NAO e erro de codigo.

### ACHADO CRITICO durante onda 3: `apps/api/src/secrets/index.ts` orfao
A regra `.gitignore` `secrets/` (material secreto) tambem ignorava diretorios de
CODIGO chamados "secrets". Consequencia: `apps/api/src/secrets/index.ts`
(`loadPlatformSecrets`, importado por index.ts/app.ts/webhooks) existia so no disco
local e NUNCA foi commitado — clone limpo teria build quebrado (modulo ausente).
Exposto ao tentar versionar a UI `features/platform-admin/secrets/`. Fix: negacoes no
.gitignore para diretorios de fonte chamados "secrets" + commit do modulo orfao.
Pre-existente a F25 (arquivo de 09/jun), nao introduzido por esta fase.

---

## F26 — Platform Tenant Management (orchestrator) — 2026-06-13

### Onda 1 despachada: S01 (db) + S02 (workspaces 360) + S03 (plans CRUD) + S11 (docs)
File-sets disjuntos: `packages/db/**` (S01) vs `apps/api/src/routes/platform/workspaces.ts`+`services/platform/workspace-360.ts` (S02) vs `apps/api/src/routes/platform/plans.ts` (S03) vs `docs/runbooks/*`+`docs/security/**` (S11). Zero overlap → paralelizáveis. S11 escreve só os 2 runbooks agora; a auditoria /hm-security da impersonation roda APÓS S05 mergear (parte final do slot). S04/S05/S06 destravam após S01 mergear+migration aplicada (onda 2). Decisões travadas §9 respeitadas: view-as read-only, billing interno sem Stripe, ordem A→B→D→C, playground só super-admin.

### F26-S06 — boundary: finalize.py editado (decisão do orchestrator)
A invariante "custo do sandbox vai com is_test=true + NÃO grava agent_executions" exige
tocar o node de persistência `app/nodes/finalize.py`, que NÃO estava no files_allowed
literal de S06 (run.py, sandbox/**, tests/**). finalize.py é o ÚNICO ponto onde o runtime
persiste (agent_executions + llm_usage_logs) — neutralizá-lo é o coração do sandbox.
Decisão: editar finalize.py de forma ADITIVA (guard `if not is_sandbox(state)` no
agent_executions; coluna is_test no llm_usage_logs) + novo módulo `app/sandbox/__init__.py`
(predicado único is_sandbox). run.py ganha `mode:'sandbox'` que liga is_playground.
A fronteira de side-effect das TOOLS já existia (ToolContext.is_playground, F2) — sandbox
só a liga. Tools de callback (send_message/register_conversion/trigger_flow) já retornam
"(simulado)" em playground; teste prova zero rede. 140 pytest verdes (133+7).

### F26 backend gotcha: drizzle envolve erro PG em `.cause` (não top-level `.code`)
Detecção de unique_violation (23505) num route Express: o DrizzleQueryError expõe o erro
do driver `postgres` em `err.cause.code`, NÃO em `err.code`. Checar ambos os níveis
(`(err as {code?}).code === '23505' || err.cause?.code === '23505'`). Usado em plans.ts.

### F26 wire: tenants vs workspaces — colisão de rota evitada
A F25 (policies.ts) já expõe GET /api/platform/workspaces (seletor simples). S02 monta o
tenant-list rico + 360 em /api/platform/tenants e /api/platform/tenants/:id (não colide).
Subscriptions (S04) e impersonation usam /api/platform/tenants/:id/... e /api/platform/impersonation.
Frontend S07/S08 devem consumir /api/platform/tenants.

---

## F27 + F28 criadas (2º terminal — layout + dashboard) — 2026-06-13

Segundo terminal (paralelo à F26). Decompostas via /hm-tasks. **Disjuntas da F26** — não tocam `packages/db`, `apps/api/src/{routes,services}/platform/**`, nem `apps/web/{features/platform-admin,app/(platform)}/**`.

**F27 — Estruturação de layout (ultrawide, frontend-only):**
- F27-S01 [frontend] PageContainer + token `max-w-content` (1600px) no preset DS + doc → `apps/web/shared/components/layout/**`, `packages/design-tokens/src/tailwind-preset.ts`, `docs/DESIGN_SYSTEM.md`. **available**.
- F27-S02 [frontend] aplica container nas shells lista/detalhe → `apps/web/app/(app)/{page,agents,campaigns,contacts,conversions,knowledge,flows}/...page.tsx`. dep S01.
- F27-S03 [frontend] aplica em settings/forms + pipeline/settings → `apps/web/app/(app)/{settings/**,pipeline/settings}/page.tsx`. dep S01.
- Full-bleed preservado (conversations, pipeline board, flows/[id], calendar). S02⊥S03 (paths disjuntos).

**F28 — Dashboard Onda A (métricas já documentadas no DASHBOARD.md, faltavam):**
- F28-S01 [backend] performance por atendente + rankings conversões (humano/IA) + métricas operacionais IA → `apps/api/src/{services,routes}/dashboard/**`. **available**. Query viva/snapshot, **zero packages/db** (otimização MV deferida p/ pós-F26-S01).
- F28-S02 [frontend] TableCard column-aware + rankings + cards IA + drill-down drawer → `apps/web/features/dashboard/**`. dep S01.

Onda B (qualidade resposta / CSAT / objeções via LLM-judge) = fase F29, será decomposta depois (depende de F26-S01 mergear; toca packages/db + agent-runtime).

### F26 — FECHADA 11/11 (orchestrator) — push a947eaa
Onda 1 (db+backend+docs): S01 (schema: impersonation_sessions platform-level + workspace_entitlement_overrides RLS + llm_usage_logs.is_test) → S02 (Tenants list + 360, no-secret) → S03 (Plans CRUD tipado) → S04 (Subscriptions + resolveEntitlements override>plano) → S05 (Impersonation API + middleware view-as READ-ONLY) → S06 (agent sandbox: mode=sandbox, zero side-effect, is_test, tools mock). Onda 2 (frontend): S07 (Tenants/360 UI) → S08 (Planos + Assinatura/entitlements UI) → S09 (View-as: banner global persistente + kill-switch) → S10 (Playground sandbox: chat SSE + trace + model override). Onda 3: S11 (2 runbooks + auditoria /hm-security da impersonation: APROVADO, sem high/critical).
WIRE (glue): app.ts monta os 5 routers de plataforma (workspaces/plans/subscriptions/impersonation/playground) gated por requirePlatformAdmin + impersonationMiddleware após auth, antes das rotas de workspace; nav-items+PlatformNav ganharam os 5 links.
HOTFIX integração: requireAuth agora honra req.impersonation (não re-resolve a sessão do admin), senão o override de workspace-alvo do view-as era clobberado pelo requireAuth per-router → view-as agora lê dados do tenant alvo end-to-end. As invariantes de segurança (read-only/no-secrets/no-platform/audit) já valiam independente disso.
Validação final: pnpm typecheck OK, pnpm lint OK (após ignorar .claude/worktrees no eslint), pnpm -r test OK (db21/api305/workers173/channels67/flow44/agents-core26/agents-client17/ui6/storage1), pnpm --filter @hm/web build OK (6 rotas F26), agent-runtime 140 pytest + ruff OK, pnpm audit high = só o esbuild dev-only accept-risk (sem regressão).

---

## F27 + F28 INTEGRADAS em main (2º terminal) — 2026-06-13

Orchestrator rodou em worktree isolado (`agent-a196697cfa2d482b4`), F26 intocada. 5 slots implementados+validados como branches `review`, integrados por mim em `main` na ordem F28-S01→S02, F27-S01→S02→S03 (--no-ff). Conflitos SÓ em tasks/STATUS.md+COMMS.md (resolvidos --ours + sync). Validação integrada: @hm/api + @hm/web + @hm/design-tokens typecheck LIMPO; web build verde (todas as rotas, F26 platform + dashboard/layout coexistindo). Todos os 5 → done.

⚠️ ACHADO: `main` (closeout F26, 67983c4) está com `packages/db/src/seed-demo.ts` quebrando `pnpm typecheck` (TS1355/TS2352/TS2769 — drift de schema: events startAt/endAt, kb_documents) E `pnpm lint` (import `and` não usado). Esse arquivo está UNTRACKED + `packages/db/package.json` modificado, parados na árvore compartilhada — debris não-commitado da F26, NÃO tocado pela F27/F28. main está RED no nível de repo por causa disso. Precisa de fix no escopo db/F26.
