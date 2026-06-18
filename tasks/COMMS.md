
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

---

## F29 decomposta (Onda B — qualidade/CSAT/objeções via LLM-judge) — 2026-06-13

5 slots criados (2º terminal). Capacidade NOVA — ancorada em doc novo `docs/features/AGENT_QUALITY_OBJECTIONS.md` (método LLM-judge pós-conversa, schema, métricas). Decisões travadas: LLM-judge (OpenRouter no agent-runtime) p/ qualidade+objeções; CSAT por sentimento (sem survey ao cliente).

- F29-S01 [db] conversation_evaluations + objections + RLS + repos → packages/db. **available**. blocks S03,S04.
- F29-S02 [python] LLM-judge POST /internal/evaluate → apps/agent-runtime. **available**. blocks S03.
- F29-S03 [backend] worker polling conversas encerradas → judge → persist + @hm/agents-client.evaluate() → apps/workers + packages/agents-client. dep S01+S02.
- F29-S04 [backend] métricas dashboard (qualidade/CSAT/objeções rankeadas) → apps/api/services|routes/dashboard. dep S01. blocks S05.
- F29-S05 [frontend] cards qualidade/CSAT + objeções drawer → apps/web/features/dashboard. dep S04.

Roots paralelos: S01 (db) ⊥ S02 (python). Gatilho = scheduler/poll (não toca caminho de fechamento de conversa na API). main verde+pushado; packages/db estável → S01 pode arrancar.

## F29 — execução isolada em worktree (agent-a3d4a1fa835ce7d9c), 2026-06-13

Worktree dedicado (isolation: worktree); base resetada para `main` (10f297e) para herdar os 5 slots F29 (estavam 1 commit à frente do checkout do worktree). NÃO mergeei em main — todos os slots parados em `finish` (review). Eu (Rogério) integro depois.

Resultado: 5/5 slots em REVIEW, todos verdes.
- F29-S01 (db, feat/f29-s01, 0e84086): schema conversation_evaluations + objections + RLS (migrations 0037 tabelas / 0038 RLS) + repo + rls.test. `pnpm --filter @hm/db test` = 24 verdes (3 novos F29 incl. cross-tenant deny + UNIQUE + CHECK).
- F29-S02 (python, feat/f29-s02, b33da4c): /internal/evaluate (LLM-judge OpenRouter, JSON forçado, temp 0) + app/evaluation/* + llm_usage_logs(request_type='evaluation'). `ruff` + `pytest` = 156 verdes (16 novos). Judge real NÃO exercido em CI (mock httpx) — E2E real precisa key.
- F29-S03 (workers+agents-client, feat/f29-s03, e1df5f3): scheduler 5min idempotente (lock Redis) → judge → persist eval+objections em tx RLS + @hm/agents-client.evaluate() (Zod). `pnpm --filter @hm/workers test` = 177 verdes (4 novos: persist, idempotência, falha-não-persiste).
- F29-S04 (api dashboard, feat/f29-s04, caa9bf8): 5 métricas (qualidade média/por agente/por atendente, CSAT, objeções rankeadas) + drill-down objeções por categoria. `pnpm --filter @hm/api test` = 311 verdes (3 novos de visibilidade/role + dados).
- F29-S05 (web dashboard, feat/f29-s05, b442d96): CsatCard (distribuição promoter/neutral/detractor) + score/100 + drawer objeções 2-níveis (categoria→exemplos). `pnpm --filter @hm/web build` verde. Zero hex.

### Achados load-bearing
- **`packages/db/src/index.ts` NÃO está em files_allowed de NENHUM slot F29.** Logo `evaluationsRepo` (criado em S01) não é exportado do barrel `@hm/db`. S03 (worker) e S04 (dashboard) consomem via `schema.*` direto (padrão já usado por todos os workers/dashboard) — sem violação de fronteira. O repo de S01 fica disponível mas não re-exportado; OK (S04 escreve queries próprias, S03 escreve schema direto). Quem integrar e quiser expor `evaluationsRepo` precisa tocar `src/index.ts` à parte.
- **Bug de janela do worker:** conversas `closed/resolved` podem ter `updated_at = NULL` (coluna sem default no insert). O LEFT-JOIN-sem-avaliação usa `coalesce(c.updated_at, c.created_at)` na janela de lookback — senão conversas recém-encerradas nunca seriam avaliadas. (corrigido em S03)
- **Nomes reais de schema:** `conversation_evaluations` (UNIQUE conversation_id, handled_by/quality_score/sentiment_score/csat_label/judge_model/judge_cost_usd numeric(12,6)/raw jsonb) + `objections` (FK evaluation_id CASCADE, category CHECK vocab fixo). `agent_id`/`primary_member_id` vêm de `conversations.agent_id`/`conversations.assigned_to` (o judge só opina em handled_by).
- **Contrato do judge (S02→S03→S04):** `EvaluateResponse = { result: JudgeResult, judge_model, judge_cost_usd }`. JudgeResult = quality_score 0-100, quality_rationale?, sentiment_score -100..100|null, csat_label?, handled_by, objections[]. Espelhado em Zod (`@hm/agents-client`) e Pydantic.
- **Drill-down de objeções:** rota `/api/dashboard/metrics/objecoes_rankeadas?param=<categoria>` → exemplos (excerpt+resolved). Categoria inválida = 404/unknown (anti-exfiltração). Sem param = ranking.
- **Migrations:** geradas no worktree (estado = main, F26 incluída) → 0037 (tabelas) + 0038 (RLS manual). Journal `_journal.json` + snapshots 0037/0038 commitados. Aplicadas no Postgres dev local (tagix-dev-postgres-1) limpo.

NÃO toquei main / F26 / F27 / F28. NÃO mergeei. NÃO rodei `done`/`sync` que afete STATUS compartilhado de main.

---

## F29 INTEGRADA em main (2º terminal) — 2026-06-13

Orchestrator em worktree isolado (a3d4a1fa), F26/F27/F28 intocadas. 5 slots implementados+validados, integrados por mim em main na ordem S01→S05 (--no-ff, encadeadas, merges limpos — zero conflito de código). main primário tinha avançado p/ 71d4636 (fix flows do outro terminal, disjunto). Validação INTEGRADA verde: typecheck+lint (todos), @hm/db 24, @hm/api 311, @hm/workers 177, web build, python ruff+pytest 156. Migrations 0037/0038 aplicadas no Postgres dev. Todos os 5 → done.

Achados: `packages/db/src/index.ts` não estava em files_allowed → `evaluationsRepo` consumido via `schema.*` direto (padrão do repo); worker usa `coalesce(updated_at, created_at)` na janela (updated_at pode ser NULL). Judge real (OpenRouter) NÃO exercido em CI — precisa OPENROUTER_API_KEY + JUDGE_MODEL no runtime (E2E manual).

---

## [orchestrator:F30] 2026-06-13 — sessao F30 LiveChat Operacao 2.0 iniciada

Outra(s) sessao(oes) podem estar mexendo em OUTRAS fases concorrentemente. Eu toco SOMENTE slots da F30.
- Commitei o decomposition da F30 (10 slots + docs/features/LIVECHAT_OPS.md) em 76d76ce — paths F30-only, sem git add -A.
- DISPATCH: F30-S01 (fundacao critica — db-engineer). Bloqueia todos os outros 9. files_allowed: packages/db (schema inbox/org/conversations/index, repos/livechat, drizzle/**, rls.test) + packages/shared (permissions, socket-events, types/inbox, index). Vou claimar e despachar o engineer.

## [orchestrator:F30] 2026-06-13 — F30-S01 worker DISPATCHED

claim OK (branch feat/f30-s01, commit ee4e9fd). Despachei db-engineer via claude -p --agent db-engineer (background) com brief self-contained referenciando o slot .md + LIVECHAT_OPS.md. Worker escreve+typecheck no SEU pacote (@hm/db + @hm/shared), SEM git. Eu integro. Gotchas passados: matriz ja tem conversation.resolve/snooze/toggle_ai (so adicionar ai_mode + inbox.visibility.manage); proxima migration = 0039; RLS manual p/ inbox_visibility_settings + member_visibility_overrides. Demais 9 slots seguem blocked ate S01 mergear em main.

## [orchestrator:F30] 2026-06-13 — F30-S01 MERGEADO em main + lote 2 despachado

S01 (fundacao) integrado em main: typecheck (13 projetos) + lint + @hm/db 28/28 VERDES; migrations 0039 (DDL) + 0040 (RLS manual) aplicadas limpas. Merge --no-ff. done + commit bookkeeping.
ACHADO: o worker do S01 tambem editou packages/db/src/seed-demo.ts (FORA do files_allowed — era trabalho F29/dev-workspace de outra sessao). REVERTI seed-demo.ts ao HEAD antes de integrar — NAO foi mergeado. So os 15 paths do files_allowed entraram.

LOTE 2 (deps = [S01] done): despacho paralelo de 5 slots com files_allowed DISJUNTOS, cada um validando SO o seu pacote:
- S02 (backend) conversations/state.ts + app.ts — ai_mode/resolve/snooze toggle
- S07 (backend) conversations/index.ts — enforcement de visibilidade na list (usa buildVisibilityPredicate de S01)
- S08 (backend) org/org.ts — API de config de visibilidade + peer-privacy
- S09 (workers) inbound/db-ports + ports — auto-assign engine (usa pickAutoAssignee de S01)
- S05 (python) agent-runtime nodes load_context/build_prompt — retomada consciente de contexto
Workers escrevem na arvore (sem git), eu integro 1 a 1 via stash-dance por paths. S03/S04/S06/S10 seguem depois (deps em S02/S04/S05/S07/S08).

## [orchestrator:F31] 2026-06-15 — Flow Builder v2 arrancada: Onda A (S01 + S03) em paralelo

Plano aprovado: ~/.claude/plans/encapsulated-juggling-fern.md. 12 slots em tasks/slots/F31/. plan-batch confirmou lote inicial sem colisao de files_allowed:
- F31-S01 [critical] backend-engineer — Bridge outbound real (CAMINHO CRITICO; desbloqueia S02/S04/S06/S09/S10). files: packages/flow-engine/src/{types.ts,ports/outbound.port.ts} + apps/workers/src/flows/{outbound-publisher.ts,worker.ts,outbound-publisher.test.ts}.
- F31-S03 [high] frontend-engineer — helpers-context + VariablesPicker + pickers/**. files: apps/web/features/flow-builder/shared/helpers-context.tsx + inspector/{VariablesPicker.tsx,pickers/**}. Desbloqueia S04/S05/S06/S07/S08.

files_allowed 100% disjuntos (flow-engine+workers vs apps/web/features/flow-builder). Despacho via background agents; cada um escreve+typecheck SO no seu pacote, SEM git. Eu integro via stash-dance por paths explicitos (proibido git add -A). Onda B (S02/S04/S05/S06/S07/S08) abre apos S01+S03 em main.

## [orchestrator:F31] 2026-06-15 — Onda A INTEGRADA + Onda B (6 slots) despachada

Onda A mergeada em main, typecheck 13 projetos VERDE:
- F31-S01 (bridge outbound real): merge 35c8353; @hm/workers 217 testes + @hm/flow-engine 44 testes verdes; outbound-publisher.test.ts 12 testes. Follow-up do agente: interactive/meta_flow/external_notify ainda no-op no publisher (precisam traducao p/ InteractivePayloadSchema do job) — repassado a S04/S06.
- F31-S03 (helpers-context + pickers + VariablesPicker): merge; 9 dominios, 9 pickers + Combobox, FlowHelpersAutoProvider self-fetching. SEAM ABERTO: FlowEditorPage.tsx precisa montar <FlowHelpersAutoProvider> (orchestrator fecha na integracao da Onda B/S08).

GOTCHA confirmado: board nao flipa blocked->available mesmo com deps done; claim manual valida deps de verdade. Deps de S02/S04/S05/S06/S07/S08 (S01/S03) satisfeitas.

Onda B: 6 slots com files_allowed DISJUNTOS (node dirs + handlers proprios; S08 dona da espinha registry/validation/catalog/nodeTypes/nodeInspectors). Despacho paralelo via background agents:
- S02 message rico, S04 interactive, S05 http_request, S06 condition/notify/ai, S07 triggers, S08 scaffold+catalogo.
S08 NAO colide com S02/S04/S05/S06/S07 (dirs/spine diferentes); S08 nunca paralelo com S09/S10/S11. Integro 1 a 1 via stash-dance por paths. Onda C (S09/S10/S11) abre apos S08.

## [orchestrator:F31] 2026-06-15 — Onda B INTEGRADA (6/6) + Onda C (3 slots) despachada

Onda B toda mergeada em main; pnpm typecheck 13 projetos VERDE; @hm/flow-engine 44 testes + @hm/workers 217 verdes a cada merge.
- S08 (scaffold): registry 16->22 handlers; 7 kinds novos no catalogo; deferred removido. FIX de integracao: registry.test.ts (fora do files_allowed do slot) atualizado 16->22.
- S02 (message rico), S05 (http_request), S06 (condition/notify/ai), S07 (triggers): verdes diretos.
- S04 (interactive): FIX de integracao no handler — z.preprocess+default quebravam o contrato z.ZodType<T> do FlowHandler (input!=output). Troquei por z.discriminatedUnion puro (sem ZodEffects no shape); superRefine mantido (preserva input==output). Perda: compat com botao legado {id,title} sem type (inspector novo sempre grava type).
SEAM fechado pelo orchestrator: FlowHelpersAutoProvider montado em FlowEditorPage.tsx (commit dedicado).
SEAMS abertos repassados: (a) endpoint /api/flows/media/signed-url backend p/ upload de midia do node message (S02 degrada p/ key manual); (b) interactivePayload/external_notify ainda no-op no publisher do S01 (precisa traducao p/ InteractivePayloadSchema do job); (c) S07 SAVE-sync/LOAD-hydrate de triggerType/triggerConfig em FlowEditorPage/useFlow/services (fechando a seguir).

Onda C (deps S08 done): S09 (set_variable/input), S10 (assign/template), S11 (ab_split/go_to_flow + UI register_conversion). Disjuntos (handlers+dirs proprios). Sobrescrevem os stubs do S08 mantendo export names. Despacho paralelo via background agents; integro 1 a 1.

## [orchestrator:F31] 2026-06-15 -- Onda C INTEGRADA (4/4) + F31 COMPLETA 12/12

S09 (set_variable+input), S10 (assign+template), S11 (ab_split+go_to_flow+register_conversion UI), S12 (docs+e2e) integrados em main sequencialmente. pnpm typecheck 13 projetos VERDE; pnpm lint VERDE; @hm/flow-engine 44 testes VERDES.

ACHADO CRITICO (ZodDefault): handlers S09/S10 gerados pelo S08 usavam z.default() no schema -- quebravam FlowHandler<T> (invariancia ZodType<T>: _input != _output). FIX: trocar z.default() por z.optional() + ?? no corpo do execute (mesmo padrao dos handlers anteriores). Zero regressao.

SEAMS DOCUMENTADOS (nao fazem parte do escopo da F31):
- template.handler: publisher precisa de kind=template no OutboundJob (hoje o interactivePayload de template e no-op no publisher S01)
- go_to_flow.handler: worker precisa ler _goto_flow_execution_id apos o step e enfileirar o step do flow alvo. A execucao e CRIADA corretamente; so o enfileiramento falta.

F31 COMPLETA: 12/12 slots done. Flow Builder v2 com 22 node types, bridge outbound real, inspectors ricos, VariablesPicker, validacao de flow, registro de conversoes, encadeamento de flows, testes A/B por peso, captura tipada de respostas.

---
## F33 — Flow Engine Seams Closure (2026-06-15)

Orchestrator: claude-sonnet-4-6
Slots: F33-S01 (go_to_flow enqueue), F33-S02 (bridge interactive+template), F33-S03 (ConversionTypePicker + FlowPicker)
Files não se sobrepõem → execução sequencial na mesma árvore (sem worktrees).

Plano:
1. claim S01 → implementar → commit → finish → merge → done
2. claim S02 → implementar → commit → finish → merge → done
3. claim S03 → implementar → commit → finish → merge → done

## F35 — Pipeline CRUD para usuário final (orchestrator, 2026-06-16)

### Análise pré-dispatch

Backend (pipelines.ts): GET /api/pipelines retorna `{ pipelines: rows }` (não `data`). POST não tem limite. Nenhum teste existe.
Frontend (board/queries.ts): `usePipelines()` lê `response.pipelines`. `PipelineSettingsPage.tsx`: só gerencia stages, pipeline é imutável (dropdown sem criar/deletar).
`apps/web/features/pipeline/settings/`: queries.ts (stage mutations), index.ts, PipelineSettingsPage.tsx. Nenhum componente de CRUD de pipeline existe.

### Decisões de fronteira

- S02 muda shape de GET de `{ pipelines }` para `{ data, meta }` — S01 deve ajustar `usePipelines()` para ler `response.data`. S03 herda isso pronto.
- POST `/api/pipelines` não aceita `template` — frontend (S01) faz 2 chamadas: create pipeline → create stages. Endpoint de stages já existe.
- `<CreatePipelineModal>` extraído como componente separado em `apps/web/features/pipeline/settings/CreatePipelineModal.tsx` (dentro do files_allowed de S01), exportado pelo `settings/index.ts`. S03 importa de lá.
- S03 bloqueado até S01 done (depende do modal compartilhado).

### Wave 1 — paralelo (2026-06-16)
- **F35-S01** [web, M] CRUD settings + mutations reutilizáveis → frontend-engineer. Files: `apps/web/features/pipeline/board/queries.ts`, `apps/web/features/pipeline/settings/**`
- **F35-S02** [api, XS] Limite 10 + meta no GET → backend-engineer. Files: `apps/api/src/routes/pipeline/pipelines.ts`, `apps/api/src/routes/pipeline/pipelines.test.ts`
- Disjuntos: apps/web vs apps/api — zero overlap.

### Wave 2 — sequencial após S01 done
- **F35-S03** [web, S] Board UX (empty state + CTA + chip) → frontend-engineer.

### F35 — COMPLETA 3/3 (orchestrator, 2026-06-16)
Todos os 3 slots done, integrados, verdes em main.
- pnpm typecheck: verde (13 projetos). pnpm lint: verde. pnpm --filter @hm/api test: 426/426 verdes.
- SEAMS fechados: GET /api/pipelines shape quebrou (pipelines→data) — corrigido em PipelinePage + helpers-context (consumidores fora do files_allowed de S01 mas necessário).
- CreatePipelineModal extraído em settings/ e reutilizado no board (S03). DeletePipelineDialog com confirmacao de nome exato.
- Backend: limite via workspaceEntitlementOverrides.limits.max_pipelines (override) ou default 10.
- Gotcha: helpers-context.tsx em flow-builder/ também consumia response.pipelines — corrigido na integração do S01.

## F38-S12 (2026-06-18) — orchestrator/executor

- **Finding (latent bug, fora do escopo do slot):** `apps/api/src/routes/conversions/register.ts::registerConversion` captura a violação UNIQUE do dedup same-day (`uq_conv_events_dedup`) e retorna `{kind:'deduped'}`, mas NÃO faz `ROLLBACK TO SAVEPOINT`/rollback do statement. Num único `withWorkspace` (uma transação), o INSERT que falha deixa a transação Postgres em estado *aborted*, e o `COMMIT` da `withWorkspace` então estoura → o endpoint responde **500** em vez de tratar o dedup. A rota manual existente (`/api/conversions`, events.ts → 409) tem o mesmo defeito latente; só não é coberta por teste de dedup same-day.
- **Decisão (dentro do `files_allowed` do S12):** o handler `POST /api/v1/conversions` faz um **pré-check** (lê um evento same-day não-cancelado do mesmo tipo+contato) e curto-circuita em `deduped` ANTES do INSERT que aborta a transação. Não duplica regra de negócio (o create segue via `registerConversion`); só evita o caminho que envenena a tx. Sem tocar `register.ts` (fora do escopo).
- **Follow-up sugerido (sub-slot futuro):** trocar o `try/catch` de `registerConversion` por `ON CONFLICT (uq_conv_events_dedup) DO NOTHING ... RETURNING` para corrigir a causa-raiz e remover o pré-check redundante; corrige também a rota manual.

## F38-S08 (2026-06-18) — orchestrator/executor

- **Ajuste de files_allowed (autorizado pela nota do próprio slot S08):** o bootstrap real de socket é `apps/api/src/socket/index.ts` (singular), NÃO `apps/api/src/sockets/**` (plural). Criei o módulo de handlers em `apps/api/src/sockets/support.ts` (dentro do `sockets/**` permitido) e toquei APENAS o ponto de registro em `apps/api/src/socket/index.ts` (1 import + `wireSupportRealtime(io)` + 1 bloco de `registerSupportSocketHandlers` no connection handler). Sem alargar além do registro.
- **Decisão de transporte:** suporte emite DIRETO via o `io` em processo (a API é o único produtor de eventos de suporte), e NÃO pelo relay `hm.q.socket.relay` — cujo enum `SERVER_TO_CLIENT_EVENTS` vive em `@hm/shared` (fora do escopo do S08). Evita editar o enum compartilhado e mantém o slot self-contained. Eventos: `support:message`, `support:thread_updated`. Rooms: `support:thread:<id>`, `support:platform`.
- **Validação real-time neste host:** sockets não sobem no harness; cobri por unit test a lógica pura (autorização de join via `assertThreadVisible` + mapeamento de rooms/evento). O fluxo socket fim-a-fim fica para QA/staging (S14).

## F38-S10 (2026-06-18) — orchestrator/executor

- **Mount em app.ts (integração do orchestrator):** `createPlatformSupportRouter` foi adicionado ao barrel `routes/platform/index.ts` (no escopo do S10) e montado em `apps/api/src/app.ts` (1 import + 1 `app.use`). `app.ts` não está no `files_allowed` do S10, mas o mount é a etapa de integração do orchestrator (mesmo padrão de S03/S07 para o help reader / member support). Sem outras edições em app.ts.
- **Emit real-time:** reply/patch da plataforma chamam `emitSupportEvent` (S08, import read-only) — em testes `io` é null → no-op seguro; em runtime emite para `support:thread:<id>` + `support:platform`.

## F38 frontend wave — dispatch (orchestrator/executor) 2026-06-18
Backend done+merged (S01/S02/S03/S07/S08/S10/S12). Executor unico (sem sub-workers neste harness). Sequencial no git. S16 (fix dedup 500) feito primeiro e mergeado (482 testes @hm/api verdes).

DECISAO de fronteira — sanitizador Markdown compartilhado:
- S04 (preview do CMS) e S05 (leitor) DEVEM usar EXATAMENTE o mesmo render sanitizado (anti-divergencia + alvo do audit S15). Nenhum dos dois slots tem @hm/ui no files_allowed; o local compartilhado correto e @hm/ui.
- Construo um primitive `Markdown` em `packages/ui/src/Markdown/` ZERO-dependency: parser de um subconjunto seguro (headings, p, strong/em, code/inline-code, ul/ol/li, blockquote, hr, links http(s)/relativos) que renderiza ELEMENTOS React diretamente — NUNCA dangerouslySetInnerHTML, NUNCA passthrough de HTML cru. Isso elimina XSS estruturalmente (nenhum HTML e jamais interpretado; <script>/<iframe>/on*/javascript: nao tem como entrar). Exportado de @hm/ui (barrel explicito).
- Essa adicao a @hm/ui e feita junto da onda frontend (consumidor inicial: S04). Registrado aqui por transparencia de fronteira. S05/S06/S13 reusam o mesmo `Markdown`.

Icones de nav platform: adiciono keys `help` (S04) e `support` (S11) ao union de nav-items.ts + ambos os mapas ICONS (PlatformNav + PlatformMobileNav). APPEND, sem sobrescrever entradas existentes.
