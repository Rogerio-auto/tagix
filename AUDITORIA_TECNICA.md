# AUDITORIA TÉCNICA — Leadium (tagix / Highermind v2)

> Auditoria de produto e engenharia conduzida por um painel sênior (Staff Eng, Principal Architect, Principal Designer, DS Lead, UX, QA Lead, SRE, AI Eng), lendo o código-fonte real. Data: 2026-07-09. Branch: `main` (HEAD `933a145b`).
>
> **Convenção de evidência:** `[VERIFICADO]` = lido diretamente no código, com `arquivo:linha`. `[HIPÓTESE]` = inferência a confirmar. Prioridade calibrada por **impacto real** (P0 = bloqueia receita/atendimento ou vaza dados; estética nunca é P0).
>
> **Escopo lido:** 5.743 arquivos-fonte / ~725k LOC (apps/api 48k, apps/web 69k, apps/workers 25k, agent-runtime 10k, packages/db 13k, +9 packages). Nada foi modificado — auditoria somente-leitura.

---

## 1. Sumário executivo

1. **A fundação de engenharia é genuinamente world-class, e isso não é elogio de cortesia — é medido.** Zero `any`/`as any`/`@ts-ignore` em todo o código de produto; `pnpm typecheck` e `pnpm lint` passam limpos (exit 0); packages sem dependência circular; RLS multi-tenant com o melhor teste do repositório (`rls.test.ts`, 2.262 linhas, isolamento A/B por tabela); HMAC de webhooks constant-time; crypto AES-256-GCM correto; API keys com SHA-256 + show-once. Um comprador auditando o *código* não teria vergonha. **O problema não é o código — é o que está inacabado por trás dele.**

2. **Há um bug latente que, sozinho, invalida o pilar central do produto: os agentes de IA não respondem contra o schema real.** O runtime Python faz `SELECT ... model_supports_vision` de uma coluna que **não existe** na tabela `agents` (ela se chama `vision_model`). O primeiro nó do grafo (`load_context`) estoura `UndefinedColumnError` em toda execução real. `[VERIFICADO]` — os testes usam pool fake e por isso nunca pegaram. **Prioridade P0.**

3. **O módulo Campanhas é um scaffold elegante com o "loop de fechamento" nunca implementado.** Idempotência, compliance e opt-out são sólidos e reais — mas as métricas nunca são recalculadas (painel mostra zero para sempre), as deliveries nunca saem de `queued`, o drip só envia o 1º passo (`delaySeconds` jamais é lido), campanhas nunca chegam a `completed` (loop infinito de tick) e a edição abre o wizard em branco. É a maior distância entre "anunciado" e "funciona".

4. **A camada assíncrona tem pontos únicos de falha que se manifestam como "perda silenciosa de mensagem de cliente".** Sem reconexão AMQP (um blip de RabbitMQ reinicia a frota inteira ou trava um consumer sem alarme); só 3 das ~10 filas têm retry/DLQ (flows/campaigns/coexistence fazem *nack-drop* silencioso); flow-engine sem claim atômico (dupla execução → mensagem duplicada) e sem anti-loop (flow cíclico = DoS auto-infligido). Coerente com o histórico recorrente de "realtime some intermitente" na memória do projeto.

5. **A prontidão operacional é o gargalo real para escalar, não a capacidade técnica.** Sem healthcheck nos containers de app, deploy com downtime e sem rollback automático, Sentry desligado em produção, métricas Prometheus emitidas mas nunca coletadas, e logs sem correlação por `workspace_id`. Traduzindo: **um incidente de tenant pagante hoje é invisível e o deploy é arriscado.** Nada disso é difícil de resolver — é trabalho de plumbing, não de arquitetura.

6. **A escala esbarra num Postgres single-node não particionado.** `messages`, `agent_executions` e `webhook_events` crescem sem retenção nem particionamento; schedulers varrem tabelas cross-tenant sem índice; worker único (`replicas: 1`) processa todos os tenants. Gargalo concreto por faixa: 100 tenants = disponibilidade (SPOF); 1k = worker satura; 10k = seq scans dos schedulers; 100k = muro do PG de 1GB não particionado.

7. **O Design System tem fundação excelente (tokens dark+light AA/AAA, "zero hex" essencialmente cumprido, Button de referência) mas está bifurcado.** `@hm/ui` expõe 8 primitivos; EmptyState, Skeleton, Drawer, Select, Tabs vivem soltos em `apps/web/shared` sem governança — o que gera N reimplementações (42 `animate-pulse` à mão, 3 padrões de Drawer, 36 `<select>` nativos, 34 arquivos com `<button>` sem foco de teclado). É dívida de arquitetura de DS, não de gosto visual.

8. **Veredito de maturidade:** **engenharia de domínio nível A, prontidão de produto/operação nível C+.** O produto está mais perto de "demo impecável" do que de "SaaS pago resiliente". A boa notícia: quase toda a distância é composta de itens bem localizados e de complexidade baixa-a-média, com causas-raiz claras — não de reescrita. **Recomendação: bloquear o go-to-scale até fechar o Tier P0/Crítico (seção 4, Épico 0 e 1).**

---

## 2. Mapa do sistema

### Camadas (como entendidas, `[VERIFICADO]` salvo indicação)

```
                    ┌─────────────────────────────────────────────────┐
   Canais Meta      │  landing/ (Next estático)  →  apps/web (Next 15) │
 WhatsApp/IG/WAHA   │      App Router, RSC, React 19, DS v2 dark-first │
        │           └───────────────┬─────────────────────────────────┘
        │ webhook                    │ HTTP (api-client tipado) + Socket.io
        ▼                           ▼
┌───────────────────────────────────────────────────────────────────────┐
│  apps/api  — Express 5 + Socket.io                                      │
│  middlewares: security(helmet/CSP/CORS/HSTS) → metrics → webhooks(raw)  │
│    → json → auth(session cookie hm_session) → impersonation → uuidGuard │
│    → uuidGuard → ~50 routers de domínio → sentry → errorHandler         │
│  authz: requireAuth + requireRole(can()) ; RLS via req.scoped(withWs)   │
└───────┬─────────────────────────────────────────┬─────────────────────┘
        │ RabbitMQ (hm.q.*)                        │ SET LOCAL ROLE hm_app
        ▼                                          ▼      + app.workspace_id
┌────────────────────────────┐          ┌──────────────────────────────┐
│ apps/workers (replicas: 1) │          │ Postgres (pgvector pg16, 1GB)│
│ inbound·outbound·media·    │◄────────►│  72 tabelas c/ RLS · 135 idx │
│ flows·agents·campaigns·    │  Redis   │  MVs dashboard · embeddings  │
│ coexistence·schedulers·dlq │  (lock+  └──────────────────────────────┘
└──────────┬─────────────────┘   cache)
           │ SSE (@hm/agents-client)
           ▼
┌────────────────────────────────────────────┐
│ apps/agent-runtime (Python, FastAPI)        │
│ LangGraph: load_context → build_prompt →    │
│  call_model ⇄ tool_dispatch → finalize      │
│ OpenRouter (LLM) · RAG híbrido (vetor+FTS)  │
│ tools: database(ACL deny-by-default)+workflow│
└────────────────────────────────────────────┘
```

### Fluxo de dados de uma mensagem inbound `[VERIFICADO]`
`Meta webhook → HMAC verify + dedup de borda (provider,external_event_id) → publish hm.q.inbound → inbound worker (dedup por uq_messages_external) → persiste message + bumpConversation → hm.q.flows → agents worker → agent-runtime (SSE) → persiste resposta pending → hm.q.outbound → adapter WhatsApp → finalize → hm.q.socket.relay → io.to(ws:room).emit`.

### Isolamento multi-tenant `[VERIFICADO]`
Todo caminho tenant deve passar por `withWorkspace(workspaceId, fn)` → transação com `SET LOCAL ROLE hm_app` + `set_config('app.workspace_id', …, true)`. 72 tabelas com RLS habilitada. **Ressalva crítica** (`[VERIFICADO]` via memória de prod + código): o role de login em produção é superuser+BYPASSRLS e não há `FORCE ROW LEVEL SECURITY` — logo todo caminho que usa `getDb()` direto (billing, plataforma, webhooks) roda **sem** a rede de RLS, dependendo 100% de filtros `workspace_id` manuais.

### O que é sólido por design (para calibrar as críticas)
- **Segurança de base:** HMAC constant-time (Meta/WAHA/AbacatePay), crypto AES-256-GCM, cookies httpOnly+SameSite+secure, CORS por allowlist, CSP sem `unsafe-eval`, impersonation read-only anti-tampering, `.env` fora do git. `[VERIFICADO]`
- **Idempotência inbound:** dedup de borda + `uq_messages_external` parcial — reentrega Meta não duplica. `[VERIFICADO]`
- **Socket multi-réplica:** `@socket.io/redis-adapter` faz fan-out entre réplicas corretamente. `[VERIFICADO]`
- **Bundle/schema frontend:** code-splitting correto (recharts/xyflow/fullcalendar lazy), `optimizePackageImports`, 135 índices Drizzle, cache Redis versionado na lista de conversas. `[VERIFICADO]`
- **ACL de tools da IA:** deny-by-default por coluna com precedência `restricted > allowed` — acima da média de mercado. `[VERIFICADO]`

---

## 3. Achados detalhados

> Agrupados por área. IDs preservam a origem da auditoria. **Verifiquei pessoalmente** os achados marcados com ✔︎ (execução direta de grep/leitura de DDL).

### 3.1 Segurança

**SEC-01 — SSRF via webhooks outbound (sem allowlist de host/esquema)**
- **Problema:** A URL de destino é validada só por `z.string().url().max(2000)` — aceita `http://169.254.169.254/…` (metadata cloud), `localhost`, RFC1918. O worker e o endpoint `/test` fazem `fetch(url)` sem bloquear IP privado; o `/test` **retorna status HTTP síncrono** ao cliente.
- **Impacto:** Qualquer tenant com `webhook.edit` faz o servidor (rede interna) emitir POST arbitrário a serviços internos e sonda reachability. SSRF semi-cega + pivô lateral.
- **Evidência:** `apps/api/src/routes/dev/webhooks.ts:43,52` (`z.string().url()`) ✔︎; `apps/workers/src/webhooks/dispatcher.ts:164`. `[VERIFICADO]`
- **Solução:** Validar no boundary: só `https:`, resolver hostname e rejeitar privado/loopback/link-local/metadata; re-checar IP no connect (anti-rebinding); nunca devolver corpo/erro interno.
- **Prioridade:** Alta · **Complexidade:** Média · **Área:** Segurança/Backend · **Benefício:** Fecha o único SSRF acionável por tenant.

**SEC-02 — `AUTH_PROVIDER=mock` honrado sem checar `NODE_ENV` (bypass total de auth)**
- **Problema:** `getAuthProvider()` retorna `MockAuthProvider` sempre que `AUTH_PROVIDER=mock`, **sem verificar produção**. O mock aceita qualquer senha e emite token = base64 do payload. O comentário diz "Nunca usar em produção" mas **nada impõe**.
- **Impacto:** Um flip de env em prod = login como qualquer usuário + forja trivial de sessão. Risco elevado porque o próprio recipe de dev usa esse flag.
- **Evidência:** `apps/api/src/auth/provider.ts:21-24` ✔︎ (li: sem guarda de `NODE_ENV`); `apps/api/src/auth/mock-provider.ts:33-50`. `[VERIFICADO]`
- **Solução:** Fail-fast no boot: `if (NODE_ENV==='production' && provider==='mock') throw`.
- **Prioridade:** Alta · **Complexidade:** Pequena · **Área:** Segurança · **Benefício:** Elimina interruptor latente de bypass.

**SEC-03 — Sem `FORCE ROW LEVEL SECURITY` + role de app superusuário em prod**
- **Problema:** Nenhuma tabela usa `FORCE RLS`; o role de prod é superuser+BYPASSRLS. RLS só vale dentro de `withWorkspace`. Todo caminho `getDb()` direto (billing, plataforma, webhooks) bypassa RLS → isolamento depende 100% de filtro manual.
- **Impacto:** Um único `workspace_id` esquecido = vazamento cross-tenant, sem defesa em profundidade. O "cinto-e-suspensório" prometido não vale para owner.
- **Evidência:** `packages/db/src/rls.ts:11-20`; grep `FORCE ROW LEVEL SECURITY` = vazio. `[VERIFICADO]`
- **Solução:** Role de conexão de app **sem** superuser/bypassrls em prod; `ALTER TABLE … FORCE ROW LEVEL SECURITY` nas tabelas tenant; auditar cada `getDb()` tenant-facing.
- **Prioridade:** Alta · **Complexidade:** Média · **Área:** Segurança/Infra · **Benefício:** RLS volta a ser backstop real.

**SEC-04 — `agent_templates` tem `workspace_id` mas RLS nunca habilitada**
- **Problema:** A tabela recebe `GRANT` para `hm_app` mas não há `ENABLE ROW LEVEL SECURITY` nem policy → `hm_app` lê/escreve todas as linhas de todos os workspaces.
- **Impacto:** Query sem filtro explícito vaza prompts/templates de agente entre tenants.
- **Evidência:** `packages/db/drizzle/0015_agents_rls.sql:13` (só GRANT); ausência de `agent_templates` na lista de `ENABLE RLS`. `[VERIFICADO]`
- **Solução:** Migration habilitando RLS + policy por `workspace_id` (tratar `NULL` = global read-only).
- **Prioridade:** Média · **Complexidade:** Pequena · **Área:** Segurança/Backend · **Benefício:** Fecha gap de isolamento.

**SEC-05 — Rate-limit de login por IP+email; sem teto por IP; sem captcha no login**
- **Problema:** Chave `IP+email`; um IP contra 1.000 emails gera 1.000 chaves com contagem 1, nenhuma bloqueia. Login (diferente de signup/reset) não tem Turnstile.
- **Impacto:** Credential stuffing / password spraying passa pelo limite.
- **Evidência:** `apps/api/src/auth/routes.ts:24,44`; `apps/api/src/middlewares/rate-limit.ts:97-101`. `[VERIFICADO]`
- **Solução:** Segundo limiter puro por IP no login (ex. 60/min) + captcha após N falhas.
- **Prioridade:** Média · **Complexidade:** Pequena · **Área:** Segurança · **Benefício:** Corta stuffing distribuído.

**SEC-06 — Upload aceita SVG e confia no `Content-Type` do cliente (sem magic bytes)**
- **Problema:** `isAllowedType` libera qualquer `image/*` (inclui `image/svg+xml`) e usa só o header do cliente; sem sniff.
- **Impacto:** SVG com `<script>` armazenado → XSS se renderizado inline no domínio de storage; spoof de content-type.
- **Evidência:** `apps/api/src/routes/uploads.ts:38,51-56,86-88`. `[VERIFICADO]`
- **Solução:** Bloquear `svg+xml`; validar magic bytes (`file-type`) casando com o declarado; forçar `Content-Disposition: attachment` no serve.
- **Prioridade:** Média · **Complexidade:** Pequena · **Área:** Segurança · **Benefício:** Remove XSS via upload + spoof.

**SEC-07 — Secret do webhook AbacatePay trafega em query string**
- **Problema:** Auth primária compara `?webhookSecret=`. Query strings vazam em access logs (Traefik), Sentry breadcrumbs, histórico. Comparação é constant-time (bom), mas o segredo fica no request line.
- **Impacto:** Vazamento do secret (fonte da verdade de pagamento) → forja de eventos de billing se a camada HMAC opcional não estiver ligada.
- **Evidência:** `apps/api/src/routes/webhooks/abacatepay.ts:254-257`; `packages/payments/src/webhook.ts:42-48`. `[VERIFICADO]` (captura em log = `[HIPÓTESE]`, depende do Traefik)
- **Solução:** Tornar HMAC (`ABACATEPAY_PUBLIC_KEY`) **obrigatória** em prod; redaction da query; migrar secret p/ header.
- **Prioridade:** Média · **Complexidade:** Pequena · **Área:** Segurança · **Benefício:** Blinda a fonte da verdade de billing.

**SEC-08 — Cache de identidade serve token expirado por até 15 min**
- **Problema:** `verifyTokenResilient` faz stale-on-error, mas `verifyToken` retorna `null` tanto para rede quanto para token inválido/expirado; o ramo stale honra token revogado por até `STALE_MS`.
- **Impacto:** Janela de 15 min em que token expirado ainda autentica. (Authz de role NÃO afetada — re-busca por request.)
- **Evidência:** `apps/api/src/auth/session.ts:104-120`. `[VERIFICADO]`
- **Solução:** Só servir stale quando o provider **lança** (erro de rede), não quando retorna `null`.
- **Prioridade:** Baixa · **Complexidade:** Pequena · **Área:** Segurança · **Benefício:** Revogação em ~tempo real.

**SEC-09 — `/metrics` exposto sem autenticação**
- **Problema:** `GET /metrics` montado fora de auth ("rede interna").
- **Impacto:** Se o Traefik expuser o host, recon de rotas/volumes.
- **Evidência:** `apps/api/src/app.ts:117` ✔︎. `[VERIFICADO]` no código; exposição pública `[HIPÓTESE]`.
- **Solução:** Bloquear no edge ou exigir token/porta interna.
- **Prioridade:** Baixa · **Complexidade:** Pequena · **Área:** Segurança/Infra · **Benefício:** Remove recon trivial.

**SEC-10 — Endpoint interno de tools confia em `workspace_id` do corpo sob token estático**
- **Problema:** `/internal/tools/:toolKey` autentica por `AGENT_RUNTIME_TOKEN` (constant-time) e roda `withWorkspace(body.workspace_id)`. Vazamento do token = ação em qualquer workspace.
- **Impacto:** Comprometimento do token único = ação cross-tenant irrestrita.
- **Evidência:** `apps/api/src/internal/tools/router.ts:124-135`; `auth.ts:44-58`. `[VERIFICADO]`
- **Solução:** Rotação do token, restringir à rede do runtime (mTLS/allowlist), escopo por chamada.
- **Prioridade:** Baixa · **Complexidade:** Média · **Área:** Segurança/Infra · **Benefício:** Reduz blast radius.

### 3.2 Confiabilidade / Filas / Flow-engine (Infra assíncrona)

**INF-01 — Zero resiliência de conexão AMQP (sem reconnect / recuperação de canal)**
- **Problema:** `connectMq` abre connection+channel e pronto — nenhum `on('error')`/`on('close')`/reconexão em todo o monorepo. Cada worker mantém a conexão para sempre.
- **Impacto:** Restart/upgrade/blip do RabbitMQ → (a) `'error'` não-tratado vira `uncaughtException` → `process.exit(1)` reinicia **a frota inteira**; ou (b) só o canal morre, a connection segue "saudável" e o consumer **para de consumir silenciosamente** — mensagens de cliente empilham sem alarme. Raiz provável do "realtime some intermitente".
- **Evidência:** `packages/shared/src/mq/connection.ts:10-15`; `apps/workers/src/main.ts:458-470`. `[VERIFICADO]`
- **Solução:** Wrapper com auto-reconnect+backoff (amqp-connection-manager), re-declara topologia e re-registra consumers; marca processo unhealthy enquanto desconectado.
- **Prioridade:** Crítica · **Complexidade:** Média · **Área:** Infra · **Benefício:** Elimina outage invisível e restart em cascata.

**INF-03 / DB-07 — Filas não-confiáveis descartam mensagem em erro (nack-drop silencioso)** ✔︎
- **Problema:** `reliableQueues()` retorna **apenas** `inbound/outbound/media`. `flows`, `flow.execution`, `campaigns`, `coexistence`, `kb_ingest`, `socket.relay` → política `null` → `channel.nack(msg,false,false)` = descarte silencioso em qualquer throw.
- **Impacto:** No flow worker, um blip de DB durante `patchExecution` → nack-drop; a execução fica `running` para sempre e **nada a re-enfileira** (o scheduler só pega `waiting`). Flow de venda trava sem erro visível. Execução de agente/campanha perdida sem rastro.
- **Evidência:** `packages/shared/src/mq/retry.ts:89-95` ✔︎ (li: `return [QUEUES.inbound, QUEUES.outbound, QUEUES.media]`); `packages/shared/src/mq/index.ts:73-79`; `apps/workers/src/flows/scheduler.ts:96-106`. `[VERIFICADO]`
- **Solução:** Incluir flows/flowExecution/coexistence/campaigns/kb_ingest em `reliableQueues()` (a topologia de retry já existe); wakeup também re-enfileira `running` estagnado (heartbeat/lease).
- **Prioridade:** Alta · **Complexidade:** Baixa · **Área:** Infra · **Benefício:** At-least-once end-to-end, não só no canal de mensagem.

**INF-02 — Falha transitória de provider vira "falha" permanente; retry durável nunca usado no outbound**
- **Problema:** O adapter WhatsApp captura todo erro (inclusive `MetaError{retryable:true}`) e retorna `{ok:false}` em vez de lançar; `finalizeOutbound` persiste `failed` e **ack'a** o job. A ladder durável (5s→30s→2m→10m→30m) só dispara quando o handler lança.
- **Impacto:** Um 429/5xx/timeout da Meta → mensagem "falha no envio" ao usuário **sem re-tentativa durável**. O flag `retryable` é descartado.
- **Evidência:** `packages/channels/src/meta/whatsapp/adapter.ts:214-226`; `apps/workers/src/outbound/finalize.ts:49-68`. `[VERIFICADO]`
- **Solução:** Propagar erro retryable como exceção (429/5xx/timeout) → ladder reprocessa; manter `failed` só para erro de conteúdo permanente. O guard `findSentExternalId` já evita duplicação.
- **Prioridade:** Alta · **Complexidade:** Média · **Área:** Infra · **Benefício:** Não perde envio por falha transitória.

**INF-04 — Flow-engine sem controle de concorrência: dupla execução → mensagem duplicada**
- **Problema:** `loadExecution` é `SELECT` puro (sem `FOR UPDATE`); `patchExecution` é UPDATE incondicional; o guard de status é read-then-act não-atômico. Com `prefetch(8)` + `consume` concorrente, dois envelopes do mesmo `executionId` (ex.: resume + wakeup) rodam em paralelo.
- **Impacto:** Nó executa 2× → **duas mensagens outbound**, dois advance, execução divergente.
- **Evidência:** `packages/flow-engine/src/ports/db.port.ts:87-104,116-131`; `dispatcher.ts:287-310`. `[VERIFICADO]`
- **Solução:** Claim atômico `UPDATE … SET status='processing' WHERE id=$ AND status IN('running','waiting') RETURNING` ou lock Redis por `executionId` (já existe `RedisLockStore`).
- **Prioridade:** Alta · **Complexidade:** Média · **Área:** Infra · **Benefício:** Elimina duplicação de mensagem em flow.

**INF-05 — Flow-engine sem anti-loop: flow cíclico floda a fila infinitamente**
- **Problema:** Sem `step_count`/`visited`/teto de profundidade. Um ciclo sem `wait` (A→B→A) re-enfileira sem fim.
- **Impacto:** Flow malformado gera enxurrada infinita em `hm.q.flow.execution` → DoS auto-infligido por tenant.
- **Evidência:** `packages/flow-engine/src/dispatcher.ts:263-276`; grep `maxSteps/visited` = vazio. `[VERIFICADO]`
- **Solução:** `step_count` com teto (ex. 1000) → `failed` "loop suspeito"; detecção de ciclo na validação de publish.
- **Prioridade:** Alta · **Complexidade:** Baixa · **Área:** Infra · **Benefício:** Contém DoS de flow.

**INF-06 — Buffer de agregação da IA depende de timer in-process sem wakeup durável**
- **Problema:** O flush do lote é armado por `setTimeout` local; conteúdo vive no Redis com TTL, mas **nada re-arma o flush após restart**.
- **Impacto:** Restart do agents worker durante a janela de agregação (15-30s) → timer perdido → **a IA nunca responde àquele turno**; cliente no vácuo.
- **Evidência:** `apps/workers/src/agents/buffer.ts:190-214`. `[VERIFICADO]`
- **Solução:** Scheduler durável (padrão flow-wakeup) que escaneia deadlines vencidos e chama `flush`.
- **Prioridade:** Alta · **Complexidade:** Média · **Área:** Infra · **Benefício:** IA não perde turno em deploy/crash.

**INF-09 — Relay de socket é best-effort com nack-drop: blip de Redis derruba `message:new`**
- **Problema:** O consumer de `hm.q.socket.relay` é fila não-confiável; o handler faz `await bumpVersion(Redis)` **antes** do emit. Falha de Redis/parse → throw → mensagem descartada → evento nunca emitido.
- **Impacto:** Causa concreta de "ChatList/thread não atualiza em tempo real" intermitente.
- **Evidência:** `apps/api/src/socket/relay.ts:84-104`. `[VERIFICADO]`
- **Solução:** Emitir primeiro, bumpar depois (try/catch interno); `retry:{}` na fila do relay.
- **Prioridade:** Média · **Complexidade:** Baixa · **Área:** Infra · **Benefício:** Realtime confiável.

**INF-07 — Sem healthcheck de liveness/readiness nos workers** · **INF-08 — DLQ sem consumidor nem alerta** · **INF-10 — Shutdown não drena in-flight; locks de scheduler sem renovação** · **INF-11 — relay e campaign-followup sem prefetch (unbounded)** · **INF-12 — enqueues internos ignoram backpressure** · **INF-13 — log flood (relay por-emit em info + tick 15s)** · **INF-14 — race de `last_message` sem `GREATEST`**
- Consolidados: gaps de robustez operacional da malha. Prioridades: INF-07 Média (SPOF sem detecção), INF-08 Média (perda silenciosa até auditoria manual), INF-10/11/12 Média-Baixa, INF-13/14 Baixa. Evidências: `bootstrap/index.ts:406-437`, `dlq/index.ts:37-50`, `flows/scheduler.ts:64-78`, `relay.ts:96-99`, `inbound/db-ports.ts:906-926`. `[VERIFICADO]`
- **Solução (pacote):** `/healthz` real nos workers + healthcheck de container; métrica `hm_dlq_depth` + alerta; `channel.cancel` + drain no shutdown + watchdog de lock; prefetch no relay/followup; checar retorno de `sendToQueue`; rebaixar logs a `debug`; `SET last_message_at = GREATEST(...)`.
- **Área:** Infra · **Benefício:** Detecção e contenção de incidente.

### 3.3 Agentes de IA

**AG-01 — SELECT referencia coluna inexistente `model_supports_vision` → toda execução real falha** ✔︎
- **Problema:** `_load_agent` faz `SELECT … COALESCE(model_supports_vision, false)`, mas a tabela `agents` tem `vision_model` (não `model_supports_vision`). `COALESCE` não protege contra coluna inexistente; asyncpg levanta `UndefinedColumnError` no **primeiro nó** do grafo.
- **Impacto:** **Nenhum agente responde** quando o runtime aponta ao Postgres real. Os testes usam pool fake, por isso não pegaram. É o P0 mais crítico do produto: o pilar de IA está latentemente quebrado.
- **Evidência:** `apps/agent-runtime/app/nodes/load_context.py:71` ✔︎ (li o SELECT); `packages/db/drizzle/0014_agents_schema.sql:50-84` ✔︎ (coluna é `vision_model`); grep `model_supports_vision` em migrations = 0 ✔︎. `[VERIFICADO]`
- **Solução:** Trocar por `COALESCE((vision_model IS NOT NULL), false) AS model_supports_vision` ou remover do SELECT (ninguém consome o campo a jusante). Adicionar teste de integração de `load_context` contra schema real.
- **Prioridade:** Crítica · **Complexidade:** Pequena · **Área:** Backend/Produto · **Benefício:** Desbloqueia o runtime inteiro.

**AG-02 — `maxTokens` por agente burla o teto `max_tokens_per_call` da policy**
- **Problema:** `call_model` usa `setdefault("max_tokens", policy.max_tokens_per_call)` — só aplica o teto quando a chave está **ausente**. O ConfigTab permite `maxTokens` até 200.000, gravado sem clamp.
- **Impacto:** Bypass do controle de custo do super-admin; owner infla tokens por chamada acima do limite da plataforma.
- **Evidência:** `apps/agent-runtime/app/nodes/call_model.py:105`; `apps/web/features/agents/detail/ConfigTab.tsx:44-51`; `crud.ts:69`. `[VERIFICADO]`
- **Solução:** `model_params["max_tokens"] = min(configurado, policy.max_tokens_per_call)`.
- **Prioridade:** Alta · **Complexidade:** Pequena · **Área:** Backend · **Benefício:** Fecha bypass de policy.

**AG-03 — Respostas do wizard (`answers`) descartadas; prompt do template nunca personalizado**
- **Problema:** O wizard envia `answers`, mas `createSchema` não declara o campo → Zod strip descarta. O handler usa `tpl.promptTemplate` cru como `systemPrompt`, sem interpolar.
- **Impacto:** A etapa "Perguntas" do onboarding é decorativa; o agente sai com prompt genérico, sem o negócio/tom informado. Degrada a primeira impressão do pilar de IA.
- **Evidência:** `AgentCreationWizard.tsx:160-166` vs `crud.ts:147-151,257`. `[VERIFICADO]`
- **Solução:** Aceitar `answers` no schema; interpolar `{{q.key}}` no `promptTemplate` server-side; validar obrigatórias.
- **Prioridade:** Alta · **Complexidade:** Média · **Área:** Produto/Backend · **Benefício:** Onboarding realmente personaliza.

**AG-04 — Zero versionamento de prompt (sem histórico, diff, rollback, canary)**
- **Problema:** `system_prompt` é coluna text mutável; PATCH sobrescreve in-place. Sem draft→live, sem tabela de versões, sem `updated_by`.
- **Impacto:** Edita-se o cérebro de um agente que atende clientes ao vivo sem staging, sem "voltar à versão que funcionava", sem auditoria de quem mudou. Gap #1 vs. Fin/Sierra/Decagon.
- **Evidência:** `schema/agents.ts:43`; `crud.ts:366-396`; grep `agent_versions/rollback` = 0. `[VERIFICADO]`
- **Solução:** Tabela `agent_prompt_versions` append-only (prompt, model, params, author, label); publicação explícita draft→live; diff + rollback 1-clique; opcional canary por %.
- **Prioridade:** Alta · **Complexidade:** Média-Grande · **Área:** Produto · **Benefício:** Segurança operacional da IA.

**AG-05 — Prompt injection via mensagem/custom_fields do contato; sem moderação**
- **Problema:** Histórico e `custom_fields` do contato entram **dentro do system prompt** como texto livre, sem delimitação/sanitização. Sem camada de moderação de entrada/saída.
- **Impacto:** Contato hostil desvia comportamento, exfiltra instruções, tenta abusar de tools. ACL de coluna + cost-guard limitam o dano, mas o comportamento conversacional é manipulável.
- **Evidência:** `apps/agent-runtime/app/nodes/build_prompt.py:69-73,116-170`; grep `moderation/jailbreak` = só redaction de log. `[VERIFICADO]`
- **Solução:** Mover histórico do contato para mensagens `user`/`assistant` reais (fora do system); moderação leve; delimitadores + instrução anti-injection.
- **Prioridade:** Alta · **Complexidade:** Média · **Área:** Segurança/IA · **Benefício:** Fecha superfície conversacional.

**AG-06 — Sem trace por execução na UI: impossível responder "por que o agente disse isso"**
- **Problema:** `agent_executions.state` guarda o snapshot completo e `tool_logs` registra cada tool, mas nenhuma UI expõe uma execução individual (tabs = Config/Tools/Knowledge/Metrics/Playground; Metrics é só agregado).
- **Impacto:** Debug de produção cego; quando o agente erra numa conversa real, ninguém vê raciocínio/tools/KB/custo sem SQL manual.
- **Evidência:** `finalize.py:110-142` (grava) sem consumidor UI; `AgentDetail.tsx:119-127`. `[VERIFICADO]`
- **Solução:** Tab "Execuções" → drawer de trace (prompt→model→tool_calls→resposta, tokens/custo/latência, link OpenRouter).
- **Prioridade:** Alta · **Complexidade:** Média · **Área:** Produto/Observabilidade · **Benefício:** Loop de melhoria real.

**AG-07 — `latency_ms` nunca gravado → `avg_latency_ms` sempre 0/—** ✔︎
- **Problema:** O roll-up calcula `avg(latency_ms)` de `llm_usage_logs`, mas o INSERT do runtime não inclui a coluna. Métrica exibida na MetricsTab sempre `—`.
- **Evidência:** `apps/agent-runtime/app/nodes/finalize.py` — grep `latency_ms` = 0 ✔︎; `apps/workers/src/agents/metrics.ts:178`. `[VERIFICADO]`
- **Solução:** Medir wall-time em `call_model`, propagar no state, gravar no `finalize`.
- **Prioridade:** Média-Alta · **Complexidade:** Pequena · **Área:** Observabilidade · **Benefício:** Métrica passa a existir.

**AG-08 — Cap mensal de custo é trailing, não preventivo (estimativa pré-chamada = 0)**
- **Problema:** `estimateTurnCostUsd` passa `pricing = {null,null}` → estimativa 0 → o guard só barra **depois** que o gasto real ultrapassou o teto.
- **Impacto:** `max_monthly_cost_usd` não previne overshoot; sob concorrência, várias execuções passam todas.
- **Evidência:** `apps/workers/src/agents/run.ts:175-186`; `packages/agents-core/src/cost-guard.ts:56-60,118-119`. `[VERIFICADO]`
- **Solução:** Carregar pricing de `llm_models_whitelist` no dispatch; reserva/atomic decrement do orçamento.
- **Prioridade:** Média · **Complexidade:** Média · **Área:** Backend · **Benefício:** Cap vira barreira real.

**AG-09 — Memória de janela fixa (12/20 turnos), sem sumarização nem contagem de tokens** · **AG-10 — Sem eval automática / regressão / A-B de prompt** · **AG-11 — Config é textarea livre sem estrutura** · **AG-12 — `max_daily_invocations` provavelmente não enforçado** `[HIPÓTESE]` · **AG-13 — Sem confidence score / "tópicos não respondidos"** · **AG-14 — Handoff não entrega raciocínio ao operador** · **AG-15 — ACL de tool invisível/ineditável na UI**
- Consolidados: dívida de **ciclo-de-vida e observabilidade** da IA. Prioridades: AG-09/10/13 Médias (qualidade/iteração segura), AG-11 Média, AG-12 Média (confirmar em `policy-resolver.ts`), AG-14/15 Baixa-Média. Evidências: `build_prompt.py:26,181`, `run.ts:51`, `AgentPlayground.tsx`, `schema/agents.ts:130`, `transfer_to_human.py:23-37`, `ToolsTab.tsx:102-110`. `[VERIFICADO]` salvo AG-12.
- **Benefício:** "prompt como código + eval como gate + memória rolante" — o tecido que separa builder de brinquedo de produto world-class.

### 3.4 Módulo Campanhas

**CAMP-01 — Métricas nunca recalculadas (painel mostra zero para sempre)** ✔︎
- **Problema:** `campaign_metrics` só é **semeado** com `totalRecipients` na ativação; nenhum job/trigger atualiza sent/delivered/read/replied/failed nem as rates.
- **Impacto:** Todo o painel de monitoramento exibe 0/"—" permanentemente; sem ROI/entrega/leitura. O rate adaptativo que lê `deliveryRate` recebe sempre `null` → throttle nunca ativa.
- **Evidência:** `apps/api/src/routes/campaigns/lifecycle.ts:58` (único `insert(campaignMetrics)`) ✔︎; grep de `update(campaignMetrics)` fora do seed = 0 ✔︎. `[VERIFICADO]`
- **Solução:** Job de recompute (tick 30-60s) agregando `campaign_deliveries` → rates + `healthStatus`.
- **Prioridade:** Crítica · **Complexidade:** Média · **Área:** Produto/Backend · **Benefício:** Destrava toda a camada de relatório.

**CAMP-02 — `campaign_deliveries` nunca avança de `queued` (sent/delivered/read perdidos)** ✔︎
- **Problema:** Delivery inserida como `queued`, só muda para `failed`. O handler de read-receipts atualiza `messages.view_status` mas **não toca `campaign_deliveries`**, apesar de existir `campaign_deliveries.message_id`.
- **Impacto:** sent/delivered/read invisíveis; raiz factual de CAMP-01. Colunas `sentAt/deliveredAt/readAt` sempre nulas.
- **Evidência:** `apps/workers/src/campaigns/db-ports.ts:242` (só seta `messageId`), `:320` (só `failed`) ✔︎; `apps/workers/src/inbound/status.ts` — grep `campaignDeliver` = 0 ✔︎ (read receipt não propaga). `[VERIFICADO]`
- **Solução:** No `handleStatusEvent`, propagar para `campaign_deliveries` casando por `message_id`; emitir evento p/ recompute.
- **Prioridade:** Crítica · **Complexidade:** Média · **Área:** Backend · **Benefício:** Fecha o loop de métrica.

**CAMP-03 — Drip só envia o 1º passo; `delaySeconds` ignorado** ✔︎
- **Problema:** Após o 1º dispatch o recipient vira `sending` e nunca volta a `pending`; `pendingRecipients` só seleciona `pending`. `campaign_steps.delaySeconds` **nunca é lido** no worker.
- **Impacto:** Campanhas drip/multi-step funcionalmente quebradas: envia passo 0 e para; delays inexistentes.
- **Evidência:** `apps/workers/src/campaigns/db-ports.ts:130-157`; grep `delaySeconds` em `apps/workers/src/campaigns/` = vazio ✔︎. `[VERIFICADO]`
- **Solução:** Máquina de estados por recipient com agendamento do próximo passo em `last_step_at + delaySeconds`.
- **Prioridade:** Alta · **Complexidade:** Grande · **Área:** Produto/Backend · **Benefício:** Entrega o valor central de "drip".

**CAMP-04 — Recipient e campanha nunca chegam a `completed` (loop infinito de tick)** ✔︎
- **Problema:** Ao esgotar steps, o código só faz `continue`; nada marca `completed`. Recipients ficam `sending` eternamente; a campanha permanece `running`, reagendada a cada 60s indefinidamente.
- **Evidência:** grep `'completed'` em `apps/workers/src/campaigns/` = vazio ✔︎; `db-ports.ts:146`. `[VERIFICADO]`
- **Solução:** Ao fim do batch, se `count(pending|sending)==0` → `status='completed'`, `nextTickAt=null`.
- **Prioridade:** Alta · **Complexidade:** Baixa-Média · **Área:** Backend · **Benefício:** Fim de estado preso + libera locks.

**CAMP-05 — Edição abre o wizard em branco (não hidrata a campanha)**
- **Problema:** `/campaigns/[id]/edit` renderiza `CampaignEditor` com defaults vazios e **nenhum GET** de hidratação; `PUT /steps` faz delete+insert → sobrescreve steps com rascunho em branco.
- **Impacto:** Edição de campanha inutilizável; avançar o passo 0 falha na validação de nome vazio.
- **Evidência:** `apps/web/features/campaigns/editor/CampaignEditor.tsx:66-113`; `editor/queries.ts:57-97` (só mutations). `[VERIFICADO]`
- **Solução:** `useCampaignDetail(id)` hidratando o `WizardState` num `useEffect` guardado; em edição, navegação livre.
- **Prioridade:** Alta · **Complexidade:** Baixa · **Área:** Frontend · **Benefício:** Restaura feature anunciada.

**CAMP-06 — `dailyLimit`/`messagesSentToday` nunca aplicados** · **CAMP-07 — Reply não incrementa métrica nem atribui conversão** · **CAMP-08 — Sem preview nem test-send nem picker de templates aprovados** · **CAMP-09 — `templateComponents` (variáveis) sem UI** · **CAMP-10 — CSV é a única audiência (sem segmentação)** · **CAMP-11 — Contagem estimada só cobre o CSV** · **CAMP-12 — `PUT /steps` destrutivo sem guard de status** · **CAMP-13 — Sem retry de deliveries falhas** · **CAMP-14 — Sem "duplicar campanha"** · **CAMP-15 — Lista sem busca/ordenação/paginação** · **CAMP-16 — Sem quiet hours globais nem frequency capping** · **CAMP-17 — Send-windows sem UI granular** · **CAMP-18 — Sem A/B test nem export**
- Prioridades: CAMP-06/07/08/09 Alta (segurança de conta Meta, ROI, confiança pré-envio, personalização); CAMP-10/11/12/13/16 Média; CAMP-14/15/17/18 Baixa-Média. Evidências completas em `apps/workers/src/campaigns/*` e `apps/web/features/campaigns/editor/CampaignEditor.tsx`. `[VERIFICADO]`
- **Área:** Produto · **Benefício:** Fechar a distância vs. Klaviyo/Braze/ManyChat.

### 3.5 UX / Fluxos

**UX-01 — Conexão de canal degrada para formulário impossível** — Sem `NEXT_PUBLIC_META_*` no build, o Embedded Signup some e cai num form pedindo `authorization code` (single-use, expira em segundos). `ConnectWizard.tsx:462-508`. **Crítica** · Média · UX/Frontend — bloqueia a ativação inteira. `[VERIFICADO]`

**UX-02 — "Editar campanha" abre wizard em branco** (= CAMP-05) — **Crítica** · Média. `[VERIFICADO]`

**UX-03 — Cliente aparece como telefone/ID cru em toda a interface, nunca pelo nome** — ChatListItem/header/avatar usam `conversation.remoteId`; iniciais saem "55". `ChatListItem.tsx:153,164`; `ConversationHeader.tsx:129`. **Crítica** · Média · UX — faz o produto parecer terminal técnico, não CRM. `[VERIFICADO]`

**UX-17 (raiz) — Erro genérico idêntico em todas as telas, mascarando a causa** — Dashboard/ChatList/Contatos/Conversões/Campanhas mostram "conexão falhou" para 401/403/500/rede; `ApiError.status/ref` só usado no composer. Sessão expirada (o caso mais comum) vira "problema de conexão"; `ref` de suporte escondido. `DashboardClient.tsx:223`, `ChatList.tsx:132`, `ContactsPage.tsx:283`. **Média** (mas corrige N telas de uma vez) · Baixa · UX. `[VERIFICADO]`

**UX-04 — Página de Uso/Custo de IA sem estado de erro: falha vira "$0,00"** — `WorkspaceUsage.tsx:64-155` só trata `isLoading`; erro de rede idêntico a "não gastou nada". Cliente decide cap de custo sobre número errado. **Alta** · Baixa · UX. `[VERIFICADO]`

**UX-05 — Falha de envio = ícone vermelho de 14px invisível, sem reenviar** — `failed` renderiza só `AlertCircle` + label `sr-only`; rollback remove a bolha otimista → mensagem "some". `StatusIcon.tsx:33`; `queries.ts:160`. Em vendas, mensagem perdida = negócio perdido. **Alta** · Média · UX. `[VERIFICADO]`

**UX-06 — Badge "Canais" mostra "0 ativos" mesmo com canal ativo** — `useSectionCounters.ts:18-28` filtra `c.status==='active'` mas o objeto tem `isActive`; sempre 0. Feedback falso no ponto de maior ansiedade do onboarding. **Alta** · Trivial · Frontend. `[VERIFICADO]`

**UX-07 — "Cancelar campanha" destrutivo e irreversível sem confirmação** — `CampaignsPage.tsx:98-111` chama `cancel.mutate` direto no `onClick`. Dá para matar campanha de Black Friday com um clique. **Alta** · Baixa · UX. `[VERIFICADO]`

**UX-08 — Validação de Flow só aparece após "Publicar"; link "ver node" morto** — `showBanner` só liga em `handlePublish`; `onFocusNode` nunca é passado. `FlowEditorPage.tsx:96-215`. **Alta** · Baixa · UX. `[VERIFICADO]`

**UX-10 — Signup engole todo erro; "email já cadastrado" invisível** — `catch {}` sem binding mapeia tudo para "Algo deu errado. Recarregue.". `SignupForm.tsx:62-67`. Perde conversão no erro mais comum do funil pago. **Alta** · Baixa · UX. `[VERIFICADO]`

**UX-11 — Reenvio de confirmação é promessa morta** — Três telas prometem reenvio, mas não existe no frontend; link expira → conta nunca ativada. `VerifyEmail.tsx:71`; `LoginForm.tsx:54`. **Alta** · Média (seam backend) · UX. `[VERIFICADO]`

**UX-13 — Pipeline não tem como criar negócio manualmente** — Nenhum CTA "Novo negócio"; deals dependem 100% de nascer de conversas. `PipelinePage.tsx:174`. Para vendas B2B o CRM parece quebrado. **Alta** · Média · Produto. `[VERIFICADO]`

**UX-15 — Canvas de Flow e paleta sem coaching** — Aterrissa em canvas vazio sem overlay; `NodePalette` lista 20+ tipos label-only sem tooltip (descrições existem, só aparecem após colocar o node). `FlowCanvas.tsx:106`; `NodePalette.tsx:43`. Maior ponto de abandono. **Alta** · Baixa · UX. `[VERIFICADO]`

**UX-09/12/14/16/18–24 (consolidados)** — Editor de Flow não gated por `flow.edit` (viewer edita e não salva); timeout do Embedded Signup manda para campos que não aparecem (`setManualOpen` não chamado); Conversões com KPI financeiro somado client-side sem paginação; edição de evento recorrente reescreve a série silenciosamente; validação só no submit + botão disabled sem dizer o porquê; passo "Mensagens" pede template à mão e descarta o relatório de import; wizard de agente com "sem templates" = beco sem saída; onboarding dismissa permanente sem re-entrada; CTA da landing leva a Preços em vez do signup; empties de receita/canal são texto morto (WAHA promete QR inexistente, sem "Reconectar"). Prioridades Médias. Evidências: `FlowEditorPage.tsx:46`, `ConnectWizard.tsx:396-420`, `ConversionsPage.tsx:161`, `CalendarPage.tsx:149`, `SignupForm.tsx:39`, `CampaignEditor.tsx:289`, `TemplateStep.tsx:38`, `OnboardingProvider.tsx:47`, `landing/.../Hero.tsx:124`, `ChannelListItem.tsx:60`. `[VERIFICADO]`

### 3.6 Arquitetura / Código

**ARQ-01 — Camada de serviço/repositório ausente: rotas falam Drizzle direto**
- **Problema:** 70 arquivos de rota importam `@hm/db` com **484 chamadas de query-builder** dentro de `apps/api/src/routes`. Lógica de negócio mora no controller (ex.: `conversations/messages.ts` faz validação + persistência + auto-pausa de IA + audit + enqueue na handler).
- **Impacto:** Regra não reutilizável (workers reimplementam), difícil de testar sem HTTP, difícil de evoluir. Manutenção, não runtime.
- **Evidência:** `apps/api/src/routes/conversations/messages.ts:17-47`; `pipeline/items.ts:44-80`. `[VERIFICADO]`
- **Solução:** Extrair casos de uso para `services/<dominio>` dependendo de repos; rota = parse+authz+delegate+serialize. Incremental por domínio quente.
- **Prioridade:** Alta · **Complexidade:** Grande · **Área:** Arquitetura · **Benefício:** Evolução e testabilidade.

**ARQ-03 — Sem contrato de tipos compartilhado web↔api (DTOs re-declarados)**
- **Problema:** 468 defs de `interface`/`type` em `apps/web/features` re-declaram à mão os shapes de resposta, sem derivar dos Zod schemas das rotas.
- **Impacto:** Drift silencioso — a API muda um campo e o TS do web não acusa; bug só em runtime. A classe de bug mais cara em multi-tenant em evolução. (UX-06 é um sintoma exato disto.)
- **Evidência:** 66 imports de `@hm/shared` no web vs 468 tipos locais. `[VERIFICADO]` (amostragem)
- **Solução:** Exportar `z.infer` dos schemas via `@hm/shared`/`@hm/contracts`; consumir no web. Começar por conversations/dashboard/pipeline.
- **Prioridade:** Alta · **Complexidade:** Média · **Área:** Arquitetura · **Benefício:** Corta bugs silenciosos.

**ARQ-02 — Barrel `@hm/db` curado à mão diverge de `repos/index.ts` → reimplementação** — `dealItemsRepo.recomputeDealValue` existe mas não sai pelo barrel; `pipeline/items.ts:44` reimplementa inline. **Média** · Baixa · Arquitetura. `[VERIFICADO]`

**ARQ-04 — Mega-router público v1 (708 LOC, 18 handlers + 21 Drizzle inline)** — `routes/v1/index.ts`; superfície externa de alto risco num monólito. **Média** · Média. `[VERIFICADO]`

**COD-01–06 (consolidados)** — God-components (`ConnectWizard.tsx` 845 LOC, `InteractiveInspector.tsx` 774); moeda formatada inline em 21 pontos sem util compartilhado; 20 `console.*` no backend convivendo com `@hm/logger`; persistência de mídia espalhada por 4+ caminhos (raiz dos bugs recorrentes de "mídia some"); `dashboard/queries.ts` 1086 LOC coeso mas no limite; 3 `fetch` crus evitáveis. Prioridades Baixa-Média. `[VERIFICADO]`
- **Nota de calibração:** o código de produto é higienicamente **excelente** (0 `any`, 0 catch vazio real, packages sem ciclo, api-client tipado único). Estes são refactors de manutenção, não riscos de quebra.

### 3.7 Performance

**PERF-05 — Fanout + invalidação workspace-wide a cada `message:new`** — O relay emite para `ws:{workspaceId}` inteiro e faz `bumpVersion` do cache antes de emitir. Cada mensagem → todos os N operadores refetcham a lista, furando o cache recém-bumpado → potencial cache stampede ∝ membros online × taxa de mensagens. `relay.ts:61-94`. **Média-Alta sob volume** · Média · Performance. `[VERIFICADO]`

**PERF-01/02/03/08 (mesma doença: "invalida-e-refetcha" onde o socket já entrega)** — Zero virtualização em ChatList/thread; zero `React.memo` em `web/features` (ChatListItem re-renderiza a cada tecla); polling redundante de 15s + `staleTime:0` + focus refetch apesar do socket primário; thread sem paginação, refetch full após cada envio. `queries.ts:31-38,70-74,178-180`; `ChatList.tsx:55,183`. **Média** · Baixa-Média · Performance. `[VERIFICADO]`

**PERF-04 — Log de diagnóstico em todo emit do relay** (= INF-13a); **PERF-06 — N+1 no dispatch de campanhas** (3N queries/batch, step redundante); **PERF-07 — `SELECT *` na thread** (jsonb largo re-transferido); **PERF-09 — busca com `ILIKE '%termo%'`** (seq scan, já reconhecido como "F-perf futura"); **PERF-10 — detalhe da conversa em 4 round-trips sequenciais** (deal+contact paralelizáveis). Prioridades Baixa-Média. `[VERIFICADO]`
- **Calibração:** bundle e schema **já world-class**. A dívida é toda na camada realtime/render, com causa-raiz única.

### 3.8 Banco / Escalabilidade

**DB-01 — Tabelas quentes crescem sem limite (zero particionamento/retenção)** — `messages`, `agent_executions` (state = snapshot jsonb inteiro), `webhook_events`, `llm_usage_logs`, `tool_logs`, `flow_logs`, `deal_history`, `routing_history`. grep `PARTITION`/`retention`/`purge` = 0. **Alta** · Grande · Infra — sobrevivência do banco além de ~10k workspaces. `[VERIFICADO]`

**DB-02 — `webhook_events` promete retenção de 30d que não existe** — comentário + índice "para o sweep" existem; o sweep não. **Alta** · Baixa. `[VERIFICADO]`

**DB-03/DB-04/DB-05/ESC-04 — Índices faltantes para os schedulers cross-tenant** — `events.start_at` (calendar-reminders faz seq scan por tick), `campaigns.next_tick_at`, `agent_executions(workspace_id,started_at)` + `(status)`, `conversations.ai_mode` (reengagement seq scan). **Alta/Média** · Baixa · Infra. `[VERIFICADO]`

**ESC-01 — Worker único processa todos os tenants (sem escala horizontal)** — `workers replicas: 1` roda inbound+outbound+media+flows+agents+coexistence+kb+schedulers num processo; blast de campanha ou pico de mídia satura um único Node. **Alta** · Média · Infra. `[VERIFICADO]`

**DB-06 — FKs pendentes já resolvíveis (drift)** — `conversations.department_id/team_id/agent_id` e `messages.sender_agent_id` são uuid sem `.references()`, mas as tabelas já existem. Deletar agente/time deixa conversas apontando para lixo. **Média** · Baixa. `[VERIFICADO]`

**DB-08 — RLS depende de todo caminho passar por `withWorkspace`; login superuser bypassa** (= SEC-03) — **Alta** · Média. `[VERIFICADO]`/`[HIPÓTESE]` no papel de prod.

**DB-09 — Refresh de MV é full recompute cross-tenant num só job** · **ESC-02 — Postgres single-node capado em 1024M** · **DB-10 — pool max=20 + API replicas:1** · **DB-11/12/13 — enum vs text inconsistente, soft-delete inconsistente, jsonb sem constraint** — Prioridades Média-Baixa. `[VERIFICADO]`

#### Gargalo por faixa de escala (concreto) `[VERIFICADO]`
| Faixa | Gargalo real |
|---|---|
| **100 workspaces** | **Disponibilidade, não capacidade** — `replicas:1` em api/workers/postgres; crash do worker único derruba inbound/outbound/flows/agents de todos. SPOF. |
| **1.000** | **Worker único satura** (ESC-01) — blast de campanha ou pico de mídia enche o processo enquanto schedulers `setInterval` disputam CPU. Atraso de entrega e de resposta da IA. |
| **10.000** | **Schedulers viram seq scan** (DB-03/04, ESC-04) — calendar-reminders escaneia `events`, reengagement escaneia `conversations` por tick, sem índice; `messages` sem partição pressiona autovacuum. |
| **100.000** | **Muro do Postgres single-node não particionado** (DB-01+ESC-02+DB-10) — `messages`/`agent_executions` em centenas de milhões de linhas num nó de 1GB; índices não cabem em `shared_buffers`; `REFRESH MV CONCURRENTLY` não fecha na cadência; pool max=20 limita concorrência. Sem sharding/particionamento + escala horizontal, não passa desta faixa. |

### 3.9 Design System

**DS-01 (raiz) — DS bifurcado: primitivos essenciais vivem em `apps/web/shared`, não em `@hm/ui`** — `@hm/ui` expõe 8 primitivos; EmptyState/ErrorState/Skeleton/Sheet/CommandPalette/ResponsiveTable vivem fora da fronteira versionada, sem Ladle, sem lint boundary. Nada impede reinvenção. **Alta** · Grande · Design System — destrava DS-02/03/04. `[VERIFICADO]`

**DS-02 — Sem `Drawer` canônico → 3 padrões + 2 `Sheet.tsx` homônimos** — `help/Sheet.tsx` (lateral) e `Sheet/Sheet.tsx` (bottom) mesmo nome, conceitos diferentes; `DealDetailDrawer.tsx:68` monta backdrop à mão sem focus-trap. **Alta** · Grande · DS. `[VERIFICADO]`

**DS-03 — `EmptyState` sub-adotado: 26 importam, ~70 telas inventam o vazio** — **Alta** · Média. `[VERIFICADO]`
**DS-04 — Skeleton hand-rolled: 42 `animate-pulse` em 21 arquivos, 3 usam o primitivo** — sem `motion-reduce` garantido. **Média** · Média. `[VERIFICADO]`
**DS-05 — 34 arquivos com `<button>` cru e zero foco de teclado** — o Button do DS tem `focus-visible` impecável, mas 282 `<button>` crus o contornam; cards de dashboard clicáveis sem foco. **Média (a11y)** · Média. `[VERIFICADO]`
**DS-06 — Escala tipográfica editorial definida mas nunca aplicada** — `typography.ts` (h1 60px, body 17px) tem 0 consumo; o app usa a escala Tailwind default (`text-sm` 719×). O produto renderiza na escala genérica, não na editorial do padrão. **Média** · Média · DS/Design — diferenciação visual. `[VERIFICADO]`
**DS-07/08/09/10/11 (consolidados)** — Sem `Select` (36 `<select>` nativos); sem `Tabs` (≥7 reimplementações); sem `Badge`/`Chip`; `#1FFF13` hardcoded como default de color-picker; 233 escape-hatches de spacing arbitrário (baixo). Prioridades Baixa-Média. `[VERIFICADO]`
- **Calibração:** tokens dark+light AA/AAA completos, Button de referência, iconografia lucide consistente (193 arquivos), responsividade real (`useBreakpoint` 32, só 3 `<table>` cru), "zero hex" essencialmente cumprido (0 hex em utilitários de cor). A fundação é world-class; a dívida é arquitetura de DS.

### 3.10 Qualidade / Testes / Observabilidade / Deploy

**QA-01 — Billing/pagamentos sem NENHUM teste contra DB real** — `billing.test.ts` **e** `billing.integration.test.ts` mockam `@hm/db` inteiro; o "integration" é integração só no nome. O caminho que move dinheiro é o menos testado de verdade. **Alta** · Média · QA. `[VERIFICADO]`

**QA-02 — Suíte E2E (16 specs) não roda em CI e não hidrata local** — CI roda `vitest run`; Playwright está no script `e2e` que ninguém invoca. Zero garantia de fluxo ponta-a-ponta. **Alta** · Média. `[VERIFICADO]`

**QA-03 — Deploy sem zero-downtime e sem rollback automático** — todos `replicas:1` sem `update_config: start-first` nem `rollback_config`; default Swarm é stop-first = **downtime a cada deploy**; deploy ruim não reverte. **Alta** · Baixa · Infra. `[VERIFICADO]`

**QA-04 — Containers de app sem healthcheck** — só pg/redis/rabbitmq têm; api/workers/web/agent-runtime não. Traefik roteia antes do `/health` passar; worker travado nunca reinicia. **Alta** · Baixa. `[VERIFICADO]`

**QA-05 — Sem correlação de log por tenant (workspace_id) ou request_id** — `@hm/logger` sem contexto request-scoped (0 `.child(` com ids); `ref` aleatório por erro não propagado. Debug de incidente de tenant fica cego. **Alta** · Média. `[VERIFICADO]`

**QA-06 — Error tracking (Sentry) desligado em produção** — `SENTRY_DSN` ausente em `.env.production.example` e no compose; `initSentry()` no-op. Exceções só em stdout. **Alta** · Baixa. `[VERIFICADO]`

**QA-07 — Métricas Prometheus emitidas mas não coletadas; sem alertas/SLO** — `/metrics` existe e é bom, mas não há Prometheus/Grafana/Alertmanager no stack. Pico de erro invisível até o cliente reclamar. **Alta** · Média. `[VERIFICADO]`

**QA-08 — Job de deploy do CI aponta para o lugar errado (landmine)** — `ci.yml:88` faz `git pull && docker compose up` em `/opt/tagix`; a prod real é `/opt/leadium` via Swarm/`deploy.sh`. Inerte só por faltarem secrets; no dia que adicionarem, tenta deploy no mecanismo errado. **Alta** · Baixa. `[VERIFICADO]`

**QA-09–17 (consolidados)** — migrations rodam **depois** do stack subir (código novo × schema antigo) e são forward-only sem down; `/health` não checa RabbitMQ; testes que mockam Drizzle testam o fake; redação de PII no logger é allowlist frágil (não cobre `msisdn/wa_id/document/cpf`); agent-runtime (Python) fora do CI; CI sem RabbitMQ e sem gate de cobertura; errorHandler só `console.error`; runbooks sem "fila estourada/worker crash-loop/rollback". Prioridades Média-Baixa. `[VERIFICADO]`
- **CI existe** (`.github/workflows/ci.yml`, único arquivo) — roda typecheck/lint/test com pg+redis. `[VERIFICADO]` ✔︎
- **Registro do que é sólido:** `rls.test.ts` (2.262 linhas) é o melhor teste do repo; webhook-loss testa dedup+ordering+backpressure de verdade; assinatura Meta enforced (403 sem assinatura); `/health` real (checa DB+Redis); typecheck+lint 100% verdes ✔︎.

---

## 4. Backlog hierárquico (Epic → Feature → Task → Subtask)

> Estimativas em pontos relativos (P/M/G). Critérios de aceite (CA) verificáveis. IDs referenciam a seção 3.

### ÉPICO 0 — Destravar o que está latentemente quebrado (P0) — *pré-requisito de qualquer go-to-scale*
Objetivo: nada anunciado como funcional pode estar quebrado contra o schema/ambiente real.

- **F0.1 — Corrigir o runtime de IA** — dep: nenhuma
  - T0.1.1 (AG-01) Trocar `model_supports_vision` por `vision_model IS NOT NULL` em `load_context.py:71`. **P**. *CA:* teste de integração de `load_context` contra Postgres real passa; um agente responde numa conversa E2E.
  - T0.1.2 (AG-01) Adicionar teste de integração `runAgent` contra DB real (revela AG-03/AG-07 juntos). **M**.
  - T0.1.3 (AG-07) Gravar `latency_ms` no `finalize`. **P**. *CA:* MetricsTab exibe latência > 0.
  - T0.1.4 (AG-02) Clampar `max_tokens` pela policy. **P**. *CA:* agente com maxTokens=200k respeita o teto do workspace.
- **F0.2 — Fechar o loop de Campanhas** — dep: nenhuma
  - T0.2.1 (CAMP-02) Propagar read-receipt → `campaign_deliveries` por `message_id`. **M**.
  - T0.2.2 (CAMP-01) Job de recompute de `campaign_metrics`. **M**. *CA:* painel mostra sent/delivered/read reais.
  - T0.2.3 (CAMP-04) Marcar recipient/campanha `completed`; `nextTickAt=null`. **P**. *CA:* campanha esgotada some de "Em execução".
  - T0.2.4 (CAMP-05 / UX-02) Hidratar o wizard em modo edição. **P**. *CA:* editar campanha carrega os dados.
- **F0.3 — Ativação de canal recuperável** (UX-01/06/12) — *CA:* health-check do deploy falha se `NEXT_PUBLIC_META_*` faltar; badge "Canais" reflete `isActive`; timeout do Embedded Signup abre os campos manuais. **M**.

### ÉPICO 1 — Segurança & isolamento antes de dados de terceiros
- **F1.1** (SEC-02) Fail-fast mock em prod **P** · **F1.2** (SEC-01) Allowlist anti-SSRF em webhooks **M** · **F1.3** (SEC-03/04/DB-08) Role de app não-superuser + `FORCE RLS` + RLS em `agent_templates` **M** · **F1.4** (SEC-06) Bloquear SVG + magic bytes **P** · **F1.5** (SEC-05) Limiter por IP + captcha no login **P** · **F1.6** (SEC-07) HMAC AbacatePay obrigatória em prod **P** · **F1.7** (AG-05) Anti-prompt-injection + moderação **M**.
- *CA global:* teste de isolamento cross-tenant por rota; SSRF-suite bloqueia metadata/RFC1918; prod não sobe com provider mock.

### ÉPICO 2 — Confiabilidade da malha assíncrona (não perder mensagem de cliente)
- **F2.1** (INF-01) Auto-reconnect AMQP + unhealthy-on-disconnect **M** · **F2.2** (INF-03/DB-07) Estender `reliableQueues()` a flows/campaigns/coexistence + wakeup de `running` estagnado **P** · **F2.3** (INF-04) Claim atômico no flow-engine **M** · **F2.4** (INF-05) Anti-loop `step_count` **P** · **F2.5** (INF-02) Retry durável de outbound transitório **M** · **F2.6** (INF-06) Wakeup durável do buffer de IA **M** · **F2.7** (INF-09) Relay emite-antes-de-bumpar + retry **P** · **F2.8** (INF-07/08/10/11) Healthcheck workers + DLQ alert + drain no shutdown + prefetch **M**.
- *CA:* matar RabbitMQ e reiniciá-lo não perde mensagem nem exige restart manual; flow cíclico falha em ≤1000 steps; nenhuma fila faz nack-drop silencioso.

### ÉPICO 3 — Prontidão operacional (detectar e conter incidente)
- **F3.1** (QA-04) Healthcheck em todos os containers **P** · **F3.2** (QA-03) `start-first` + `rollback_config` **P** · **F3.3** (QA-06/15) Ligar Sentry + `captureException` no errorHandler **P** · **F3.4** (QA-07) Prometheus+Alertmanager + alertas mínimos **M** · **F3.5** (QA-05) Correlação de log por `workspace_id`/`request_id` (AsyncLocalStorage) **M** · **F3.6** (QA-08) Corrigir/remover job de deploy do CI **P** · **F3.7** (QA-10/12) `/health` checa RabbitMQ + ampliar redação PII **P** · **F3.8** (QA-16) Runbooks: fila estourada, worker crash-loop, rollback **P**.

### ÉPICO 4 — Escalabilidade de dados
- **F4.1** (DB-03/04/05, ESC-04) Índices dos schedulers **P** · **F4.2** (DB-02) Sweep de `webhook_events` **P** · **F4.3** (DB-01) Particionar `messages`/`agent_executions` + retenção **G** · **F4.4** (ESC-01) Separar workers em serviços escaláveis **M** · **F4.5** (DB-10/ESC-02) PgBouncer + nó PG dedicado + réplica de leitura **M** · **F4.6** (DB-06) FKs pendentes **P** · **F4.7** (DB-09) MV incremental / rollup **G**.

### ÉPICO 5 — Design System unificado
- **F5.1** (DS-01) Promover camada shared→`@hm/ui/patterns` + lint boundary **G** · **F5.2** (DS-02) Drawer canônico + renomear Sheets **G** · **F5.3** (DS-03/04) EmptyState + Skeleton no DS + sweep **M** · **F5.4** (DS-05) IconButton + foco de teclado + ESLint **M** · **F5.5** (DS-06) Tokenizar escala editorial **M** · **F5.6** (DS-07/08/09) Select/Tabs/Badge **M**.

### ÉPICO 6 — UX de confiança e ativação
- **F6.1** (UX-17) Helper único de erro derivado de `ApiError.status` + `ref` **P** — corrige N telas · **F6.2** (UX-03) Nome do contato em toda a inbox **M** · **F6.3** (UX-05) Estado `failed` visível + reenviar **M** · **F6.4** (UX-04) Estados de erro nas telas financeiras **P** · **F6.5** (UX-07) Confirmação em Cancelar campanha **P** · **F6.6** (UX-10/11) Erros de signup específicos + reenvio de confirmação **M** · **F6.7** (UX-08/15) Validação persistente + coaching do Flow Builder **M** · **F6.8** (UX-13) Criar negócio manual no Pipeline **M** · **F6.9** (UX-21) Onboarding "pular por agora" + re-entrada **M** · **F6.10** (UX-18/24) Validação inline + empties acionáveis **M**.

### ÉPICO 7 — Maturidade dos módulos (IA & Campanhas de nível de mercado)
- **F7.1** (AG-04) Versionamento de prompt (draft→live, diff, rollback) **G** · **F7.2** (AG-06) Trace por execução na UI **M** · **F7.3** (AG-10/13) Eval como gate + tópicos não respondidos **G** · **F7.4** (AG-09/11) Memória rolante + editor estruturado **G** · **F7.5** (CAMP-03) Drip multi-passo com delays **G** · **F7.6** (CAMP-08/09) Picker de templates + preview + test-send + variáveis **M** · **F7.7** (CAMP-06/07) Teto diário + reply→métrica/conversão **M** · **F7.8** (CAMP-10/16) Segmentação por filtro + frequency capping **G**.

### ÉPICO 8 — Refactor de arquitetura (sustentável, incremental)
- **F8.1** (ARQ-03) Contratos tipados web↔api via `z.infer` **M** — maior retorno/custo · **F8.2** (ARQ-02) `export * from './repos'` + remover dup **P** · **F8.3** (ARQ-01) Camada de serviço por domínio quente **G** · **F8.4** (COD-04) Helper único de persistência de mídia **M** · **F8.5** (COD-01/03) Quebrar god-components + `no-console` no backend **M**.

---

## 5. Quick wins (baixo esforço, ganho visível imediato)

| # | Item | ID | Esforço | Ganho |
|---|---|---|---|---|
| 1 | `vision_model IS NOT NULL` no SELECT do runtime | AG-01 | Trivial | **Destrava a IA inteira** |
| 2 | Fail-fast se `AUTH_PROVIDER=mock` em prod | SEC-02 | Trivial | Fecha bypass de auth |
| 3 | Badge "Canais" usa `isActive` | UX-06 | Trivial | Feedback correto no onboarding |
| 4 | Confirmação em "Cancelar campanha" | UX-07 | Baixo | Evita perda catastrófica |
| 5 | Helper único de erro (`ApiError.status`→mensagem+ref) | UX-17 | Baixo | Corrige N telas de uma vez |
| 6 | Healthcheck nos containers de app | QA-04 | Baixo | Deploy gateia readiness |
| 7 | `start-first` + `rollback_config` no compose | QA-03 | Baixo | Deploy sem downtime |
| 8 | Ligar Sentry + `captureException` no errorHandler | QA-06/15 | Baixo | Erros passam a existir |
| 9 | Estender `reliableQueues()` a flows/campaigns/coexistence | INF-03 | Baixo | Para de perder job silenciosamente |
| 10 | Índices dos schedulers (events.start_at, campaigns.next_tick_at, ai_mode) | DB-03/04 | Baixo | Corta seq scan por tick |
| 11 | Anti-loop `step_count` no flow-engine | INF-05 | Baixo | Contém DoS de flow |
| 12 | Relay emite-antes-de-bumpar | INF-09 | Baixo | Realtime confiável |
| 13 | Clampar `max_tokens` pela policy | AG-02 | Baixo | Fecha bypass de custo |
| 14 | Hidratar wizard de campanha em edição | CAMP-05 | Baixo | Restaura edição |
| 15 | Corrigir/remover job de deploy do CI | QA-08 | Baixo | Remove landmine |
| 16 | Rebaixar logs de diagnóstico (relay/followup) a debug | INF-13 | Trivial | Menos custo/ruído |

---

## 6. Perguntas abertas (precisam de decisão do time)

1. **Meta/WABA real:** o loop de fechamento de Campanhas (CAMP-01/02) e o runtime de IA (AG-01) parecem nunca ter sido exercitados contra número real + Postgres de prod. **Existe ambiente de staging com WABA real?** Sem ele, esses P0 continuam invisíveis nos testes.
2. **Papel de conexão do Postgres em prod:** a memória registra `leadium` como superuser+BYPASSRLS. **É intencional?** Isso anula a RLS como defesa em profundidade (SEC-03/DB-08). Migrar para role não-privilegiado exige janela de manutenção.
3. **Alvo de escala real:** o roadmap mira 1k, 10k ou 100k workspaces no próximo ano? Define se o particionamento (DB-01) e a separação de workers (ESC-01) são "agora" ou "depois".
4. **Estratégia de contratos web↔api (ARQ-03):** adotar `z.infer` compartilhado, um pacote `@hm/contracts`, ou geração OpenAPI→client? Decisão arquitetural com impacto amplo.
5. **`max_daily_invocations` (AG-12):** confirmar em `policy-resolver.ts` se é enforçado. Não li exaustivamente — é o único achado `[HIPÓTESE]` de enforcement.
6. **Política de migrations (QA-09):** adotar expand→migrate→contract com `migrate` antes do `stack deploy`? E qual o plano de reversão de schema (hoje forward-only sem down)?
7. **DS: promover `apps/web/shared`→`@hm/ui` (DS-01):** vale o custo de mover + criar lint boundary agora, ou congelar novas reimplementações primeiro e migrar incremental?
8. **Prioridade IA vs Campanhas:** ambos têm P0 de "fechar o loop". Qual é o pilar de go-to-market do próximo trimestre — define a ordem dos Épicos 0/7.

---

*Fim da auditoria. 10 frentes lidas em paralelo por auditores especialistas; achados de maior gravidade (AG-01, SEC-02, INF-03, CAMP-01/02/03/04) re-verificados diretamente pelo revisor-síntese via leitura de DDL e grep. Marcações `[VERIFICADO]`/`[HIPÓTESE]` refletem o nível de confiança de cada item.*
