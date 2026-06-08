# ARCHITECTURE — Highermind v2

> **Documento:** Arquitetura técnica de referência
> **Audiência:** Engenheiros (humano + IA) que vão implementar
> **Versão:** 0.1 — 2026-06-06

---

## 1. Visão geral em uma página

```
                       ┌──────────────────────────────────────────────────┐
                       │                    USUÁRIOS                       │
                       │  Members no painel  ·  Contacts via WhatsApp/IG  │
                       └──────────────┬──────────────────────┬────────────┘
                                      │                      │
                              HTTPS + WSS                Webhook HTTPS
                                      │                      │
                       ┌──────────────▼──────────────────────▼────────────┐
                       │              NGINX (na VPS, via aaPanel)         │
                       │  TLS termination · routing por subdomínio        │
                       └──────────────┬───────────────────────────────────┘
                                      │
        ┌──────────────────┬──────────┴───────────┬─────────────────┬──────────────┐
        │                  │                      │                 │              │
   ┌────▼─────┐     ┌──────▼──────┐       ┌──────▼─────┐   ┌──────▼──────┐ ┌────▼──────────┐
   │ Frontend │     │  API Server │       │  Workers   │   │  WAHA       │ │ agent-runtime  │
   │ (Next.js │     │  Express 5  │       │  RabbitMQ  │   │  (sidecar)  │ │ (Python)       │
   │  15 + RSC│◄────┤  Socket.io  │◄──────┤  consumers │   │  WhatsApp   │ │ FastAPI +      │
   │  Docker) │ HTTP│  Port 3001  │ relay └────┬───────┘   └─────────────┘ │ LangGraph +    │
   └──────────┘  WS └──┬─────┬────┘            │                            │ LangServe      │
                       │     │                  │                            │ Port 8001      │
                       │     │ HTTP (token interno)   ◄─────────────────────┤                │
                       │     └────────────────────────────────────────────► │                │
                       │            (call agent, tools callback)            └──────┬─────────┘
                       │                                                            │
                  ┌────┼─────────────────────────┬─────────────────┐                │
                  │    │                          │                 │                │
              ┌───▼───┐│ ┌──────────┐ ┌──────────▼────┐ ┌──────────▼──────┐ ┌──────▼──────────┐
              │ Redis ││ │  PG      │ │  RabbitMQ     │ │  Cloudflare R2  │ │  OpenRouter      │
              │ cache ││ │  pgvector│ │  3 exchanges  │ │  storage mídia  │ │  (LLM router)    │
              │ locks ││ │  +RLS    │ │  9 queues +   │ │  signed URLs    │ │  multi-model     │
              │ pubsub││ │  +ckpoint│ │  DLX retry    │ │                 │ │  (cloud SaaS)    │
              └───────┘│ └────┬─────┘ └───────────────┘ └─────────────────┘ └─────────────────┘
                       │      │
                       │      └─────────►   LangGraph PostgresCheckpointer (mesmo PG)
                       │
                  ┌────▼──────────────────────┐
                  │  Supabase Auth (externo)  │
                  │  (atrás de IAuthProvider) │
                  └───────────────────────────┘
```

**Componentes do sistema:**

| Componente | Tecnologia | Onde roda | Réplicas |
|---|---|---|---|
| Frontend web app | **Next.js 15 (App Router) + React 19 + Tailwind 4** | Container `web` rodando `node .next/standalone/server.js`; Nginx faz reverse proxy de `app.<domínio>` → `web:3000` | 1 (escala vertical; pode ir pra 2 réplicas atrás de Nginx upstream group se necessário) |
| API server | Express 5 + Socket.io | Container `api` na VPS | 1 (escala vertical) |
| Worker inbound | Node 22 + amqplib | Container `worker-inbound` | 2 |
| Worker outbound | Node 22 + amqplib | Container `worker-outbound` | 2 |
| Worker media | Node 22 + amqplib + sharp + ffmpeg | Container `worker-media` | 2 |
| Worker campaigns | Node 22 + amqplib + node-cron | Container `worker-campaigns` | 1 |
| Worker flows | Node 22 + amqplib | Container `worker-flows` | 2 |
| **Agent runtime** | **Python 3.13 + FastAPI + LangGraph + LangServe + httpx** | **Container `agent-runtime`** | **2 (stateless, scale-out)** |
| Scheduler in-process | node-cron na API ou worker dedicado | Container `scheduler` | 1 (singleton via Redis lock) |
| Postgres 16 + pgvector | self-hosted (também guarda checkpoints LangGraph) | Container `postgres` | 1 (single-master, backup em R2) |
| Redis 7 | self-hosted | Container `redis` | 1 |
| RabbitMQ 3.13 | self-hosted | Container `rabbitmq` | 1 |
| WAHA | self-hosted (Docker oficial) | Container `waha` | 1 |
| Object storage | Cloudflare R2 | gerenciado (saas) | — |
| Auth | Supabase Auth | gerenciado (saas) | — |
| **LLM router** | **OpenRouter** | **gerenciado (saas)** | — |
| Embeddings/transcription/vision | OpenAI (direto, não via OpenRouter) | gerenciado (saas) | — |

Total de containers na VPS: ~12 (sem contar o Nginx do aaPanel).

---

## 2. Decisões arquiteturais (ADRs em uma frase cada)

| # | Decisão | Resumo |
|---|---|---|
| ADR-001 | Postgres self-hosted, não Supabase | Decisão explícita do Rogério; controle total |
| ADR-002 | Drizzle ORM | Type-safety end-to-end, migrations versionadas, schema-first |
| ADR-003 | Repository pattern + interface | Permite trocar driver depois sem refazer caller |
| ADR-004 | RLS desde o início | Postgres Row Level Security sobre `workspace_id` |
| ADR-005 | Cloudflare R2 com driver abstrato | Zero egress, S3-compatible, $0.015/GB |
| ADR-006 | **LangGraph Python** para agentes (não JS) | Ecossistema Python de agentes (LangGraph, LangSmith, eval tooling, integrações de providers, observability nativa) está significativamente mais maduro que JS. Polyglot vale o trade-off: agent runtime fica em Python isolado; resto do stack Node |
| ADR-007 | pgvector para RAG | Mantém tudo no Postgres; pgvector é maduro o suficiente |
| ADR-008 | Flow Builder engine custom | Não é AI workflow; LangGraph seria overkill |
| ADR-009 | Express 5 (não Fastify) | Incumbente sólido, Express 5 trouxe async error handling nativo |
| ADR-010 | Socket.io + Redis adapter | Padrão do v1, funciona, manter |
| ADR-011 | Zustand para state global | Substitui 6 contextos React aninhados |
| ADR-012 | React Hook Form + Zod | Substitui `useFormValidation` manual |
| ADR-013 | Feature-folders | Cada feature self-contained; facilita exclusão e propriedade |
| ADR-014 | DS v2 nativo desde commit 1 | Sem coexistência legacy/v2 |
| ADR-015 | Pino para logger | Estruturado, performático, JSON nativo |
| ADR-016 | OpenTelemetry desde o começo | Instrumentação leve; Sentry/Datadog plugáveis depois |
| ADR-017 | Supabase Auth atrás de interface | MVP usa, mas trocável (Better-auth/Lucia) |
| ADR-018 | Stripe atrás de feature flag | MVP roda sem cobrança |
| ADR-019 | pnpm workspaces | Melhor que npm para monorepo |
| ADR-020 | Vitest + supertest + Playwright | Stack de teste já consolidada |
| ADR-021 | **Instagram Messaging como provider nativo via Meta Tech Provider único** | Mesmo Meta App para WhatsApp + Instagram; Embedded Signup unificado; webhook único `/webhooks/meta` despacha por `object` (`whatsapp_business_account` ou `instagram`); adapter dedicado `MetaInstagramAdapter` ao lado de `MetaWhatsAppAdapter` compartilhando cliente Graph + HMAC. Fundamentos no MVP; impl completa em F1.5. Detalhe em [`features/INSTAGRAM.md`](./features/INSTAGRAM.md) |
| ADR-022 | **OpenRouter como roteador único de LLM** (chat completion) | Single contract para OpenAI/Anthropic/Google/etc.; single billing; modelo configurável por agente via slug (`provider/model`); embeddings + transcription + vision continuam com OpenAI direto (OpenRouter não cobre). Super-admin gerencia api key da plataforma + whitelist de modelos + caps por workspace |
| ADR-023 | **Agent runtime como microsserviço Python isolado** (FastAPI + LangServe) | Node API e workers chamam o agent runtime via HTTP interno (token compartilhado); streaming via SSE proxy; tools "leves" rodam em Python, tools de negócio fazem callback HTTP para Node. Containers stateless escaláveis horizontalmente |
| ADR-024 | **Super-admin como source-of-truth das policies de IA** | Tabela `workspace_agent_policies` (per-workspace) + `llm_models_whitelist` (per-platform) + `llm_route_policies` (caps). Toda chamada ao agent runtime carrega `workspace_id` + `policy_snapshot` resolvido no Node antes de fazer RPC |
| ADR-025 | **Server Components do Next.js consomem `apps/api` por HTTP interno** | RSC fazem `fetch(http://api:3001/...)` via cliente server-side que injeta cookie de sessão. `apps/web` NÃO importa `packages/db` em runtime. Single source of truth: toda lógica de auth + RLS + business fica em `apps/api`. Trade-off: ~5-15ms LAN hop por SSR; ganho: zero duplicação e RLS centralizado |

Cada ADR deve virar um arquivo curto em `docs/decisions/ADR-XXX-titulo.md` após `/hm-init`.

---

## 3. Estrutura de monorepo

```
highermind-v2/
├── apps/
│   ├── api/                  # Express + Socket.io (serve API + WS)
│   ├── web/                  # Next.js 15 (App Router) — app autenticado + (futuro) landing
│   │   ├── app/              # rotas + layouts; Server Components por default
│   │   ├── features/         # lógica por domínio (componentes, hooks, queries)
│   │   ├── shared/           # primitives DS v2 + libs (api-client, query, socket, supabase)
│   │   ├── middleware.ts     # auth check via Supabase cookie
│   │   ├── next.config.mjs   # output: 'standalone'
│   │   └── tailwind.config.ts
│   ├── workers/              # 5 processos worker Node (compartilham código com api/)
│   └── agent-runtime/        # Microsserviço Python (FastAPI + LangGraph + LangServe)
│       ├── pyproject.toml    # uv / poetry
│       ├── app/
│       │   ├── main.py       # FastAPI factory; mount LangServe routes
│       │   ├── graph.py      # build_graph() — StateGraph com nodes
│       │   ├── nodes/
│       │   ├── tools/        # tools "leves" Python; tools de negócio = httpx callback ao Node
│       │   ├── policy.py     # aplica workspace_agent_policy antes de invocar grafo
│       │   ├── providers/    # OpenRouterProvider (HTTP, streaming, tool calls)
│       │   ├── checkpoint.py # PostgresSaver setup
│       │   └── usage.py      # registra llm_usage_logs no Postgres direto
│       └── tests/
│
├── packages/
│   ├── shared/               # Zod schemas, types, utils compartilhados (Node)
│   ├── db/                   # Drizzle schema + migrations + repo helpers
│   ├── agents-client/        # cliente HTTP tipado para chamar agent-runtime (substitui o antigo packages/agents)
│   ├── flow-engine/          # Engine de execução do Flow Builder (Node)
│   ├── channels/             # Adapters Meta (WhatsApp + Instagram), WAHA
│   ├── storage/              # IStorageDriver + R2Driver + LocalDriver
│   ├── ui/                   # Componentes UI compartilhados (DS v2)
│   ├── design-tokens/        # CSS variables + tailwind preset
│   └── logger/               # Pino wrapper + PII masking
│
├── infra/
│   ├── docker/               # Dockerfiles (incluindo agent-runtime.Dockerfile) + docker-compose.prod.yml
│   ├── nginx/                # Configs (referência; produção via aaPanel)
│   ├── scripts/              # deploy.sh, backup.sh, migrate.sh
│   └── github-actions/       # CI/CD workflows
│
├── docs/
│   ├── decisions/            # ADRs
│   ├── runbooks/             # Operação (deploy, incident, backup, meta-app-review-instagram, rotate-openrouter-key)
│   ├── api/                  # OpenAPI spec (Node) + agent-runtime OpenAPI
│   └── design-system/        # Showcase + tokens
│
├── package.json              # workspace root (Node)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
└── README.md
```

**Polyglot:** o repo é predominantemente TypeScript com `apps/agent-runtime/` em Python isolado. CI roda jobs separados (Node + Python). Comunicação Node ↔ Python é exclusivamente HTTP/SSE com token compartilhado (`AGENT_RUNTIME_TOKEN`), nunca filesystem ou shared lib.

**Comparação com v1:**

| v1 | v2 |
|---|---|
| `backend/` flat com `src/` enorme | `apps/api/` + `apps/workers/` + `packages/*` |
| `frontend/`, `cadastro/`, `landing/` workspaces separados | só `apps/web/` no MVP; cadastro/landing fase 2 |
| `packages/shared/` único | `packages/{shared,db,agents,flow-engine,channels,storage,ui,design-tokens,logger}/` |
| `tasks/` slots manuais para multi-dev | `docs/decisions/` ADRs + `docs/runbooks/` |

---

## 4. Backend: composition root

`apps/api/src/index.ts` (entrypoint) é a composition root única. Ela:

1. Carrega `env` validado por Zod (`src/env.ts`).
2. Cria conexões: Postgres pool, Redis, RabbitMQ.
3. Configura logger Pino + OpenTelemetry SDK.
4. Inicializa Express + middlewares (helmet, cors, compression, cookie-parser, body-parser com limite generoso).
5. Configura Socket.io com Redis adapter.
6. Registra rotas via `register*Routes(app)` modulares (mantém padrão do v1).
7. Aplica middleware de auth atrás de gate por path-prefix:
   - `/api/v1/*` → `requireApiKey` + rate limit por API key
   - `/admin/*` → `requireAuth` + `requireRole(['ADMIN', 'OWNER'])`
   - `/conversations/*`, `/agents/*`, `/campaigns/*` → `requireAuth` + `requireActiveSubscription` (hard block se feature flag ativa)
   - resto autenticado → `requireAuth` + `warnInactiveSubscription` (header X-Subscription-Warning)
8. Inicializa scheduler in-process (jobs cron com Redis lock para evitar duplicação se rodar em N réplicas).
9. Liga server.listen() e registra graceful shutdown (SIGTERM → drain queue connections → close DB pool → exit 0).

### 4.1 Estrutura interna de `apps/api/src/`

```
apps/api/src/
├── index.ts                  # composition root
├── env.ts                    # validação Zod das envs
├── server.ts                 # Express app factory
├── routes/
│   ├── public/               # /api/v1/*
│   ├── private/              # rotas autenticadas
│   ├── admin/                # /admin/*
│   └── webhooks/             # /webhooks/meta, /webhooks/stripe
├── middlewares/
│   ├── requireAuth.ts
│   ├── requireApiKey.ts
│   ├── requireRole.ts
│   ├── requireActiveSubscription.ts
│   ├── rateLimit.ts
│   └── errorHandler.ts
├── services/                 # business logic puro (sem express)
├── socket/
│   ├── index.ts              # setup
│   ├── handlers/             # event handlers por domínio
│   └── relay.ts              # bridge RabbitMQ → Socket.io
├── lib/                      # utils internos (não compartilhados)
└── tests/
```

### 4.2 Workers: composition

Cada worker é um processo independente com sua composition root em `apps/workers/src/<name>/index.ts`:

```
apps/workers/src/
├── inbound/
│   ├── index.ts              # composition; consume q.inbound.message
│   ├── handlers/             # 1 handler por tipo de evento
│   └── tests/
├── outbound/
│   ├── index.ts              # consume q.outbound.request
│   ├── parse.ts, dispatch.ts, process.ts, finalize.ts (mantém v1)
│   ├── adapters/             # MetaAdapter, WAHAAdapter
│   └── tests/
├── media/
│   ├── index.ts              # consume q.inbound.media
│   ├── download.ts, encode.ts, upload.ts
│   └── tests/
├── campaigns/
│   ├── index.ts              # consume q.campaign.followup + cron
│   └── tests/
├── flows/
│   ├── index.ts              # consume q.flow.execution
│   ├── runner.ts             # invoca flow-engine package
│   └── tests/
└── shared/
    ├── singleInstance.ts     # Redis PID lock
    └── distributedLock.ts    # redlock
```

Todos os workers usam `packages/db`, `packages/channels`, `packages/storage`, `packages/logger`. **Zero duplicação de domain logic** com `apps/api`.

---

## 5. Data layer

### 5.1 Postgres

- **Versão:** Postgres 16 com extensions: `pgvector`, `pg_trgm`, `uuid-ossp`, `pgcrypto`.
- **Encoding:** UTF-8.
- **Timezone:** `America/Sao_Paulo` no banco; aplicação converte para UTC quando necessário.
- **Pool:** `pg.Pool` via `postgres` driver (não `pg`, é mais rápido), tamanho 20 por processo.
- **RLS:** Habilitado em todas as tabelas com coluna `workspace_id`. Policies definidas em SQL e versionadas via Drizzle migrations.
- **Backup:** Dump diário 03:00 BRT para R2 (encrypted at rest). Retenção 30 dias. Restauração testada mensalmente.

### 5.2 Drizzle ORM

- **Schema-first:** `packages/db/src/schema/*.ts` define tabelas em TypeScript.
- **Migrations:** `pnpm db:generate` gera SQL; `pnpm db:migrate` aplica.
- **Sem repositórios "classe":** funções puras em `packages/db/src/repos/`:
  ```ts
  export async function getConversationById(db: DB, id: string): Promise<Conversation | null>
  export async function listConversationsByWorkspace(db: DB, workspaceId: string, filters: Filters): Promise<Conversation[]>
  ```
- **Tipagem:** `import type { Conversation } from '@hm/db'`. Inferido do schema.
- **RLS:** Drizzle gera SQL com `SET LOCAL app.workspace_id = '<id>'` no início da transaction; policies usam `current_setting('app.workspace_id')`.

### 5.3 Redis

Mesmo padrão do v1, mas refatorado:

- **Client:** ioredis singleton.
- **Key builders:** `packages/db/src/cache/keys.ts` com funções tipadas:
  ```ts
  export const k = {
    conversation: (id: string) => `hm:conv:${id}`,
    conversationList: (wsId: string, filters: ListFilters) => `hm:conv:list:${wsId}:${hashFilters(filters)}`,
    authToken: (sha: string) => `hm:auth:${sha}`,
    // ...
  };
  ```
- **TTL constants:** declaradas em um lugar (`CACHE_TTL`).
- **Helpers:** `rGet<T>`, `rSet`, `rDel`, `rDelMatch` mantidos.
- **Distributed locks:** Redlock para idempotência de jobs cron.
- **Per-chat FIFO lock:** mantém FX-007 (90s TTL no outbound).
- **Auth cache:** mantém pattern do v1 (300s TTL).

**Cache invalidation:**
- Lições do v1: 16+ keys por conversa = invalidação manual frágil.
- Solução v2: **cache key versioning** + **secondary index** centralizado.
  - Cada conversa tem uma `version` em `hm:conv:v:{id}` (incrementa em write).
  - Lista cache key inclui hash de filtros + version global por workspace.
  - Invalidação: bump version (1 RTT), não delete N keys.

### 5.4 Storage (R2)

- **Driver pattern:**
  ```ts
  // packages/storage/src/driver.ts
  export interface IStorageDriver {
    upload(input: UploadInput): Promise<{ key: string; publicUrl?: string; sha256: string }>;
    delete(key: string): Promise<void>;
    getSignedUrl(key: string, opts: { expiresIn: number; download?: boolean }): Promise<string>;
    exists(key: string): Promise<boolean>;
  }
  ```
- **Implementações:**
  - `R2Driver` (produção) usando `@aws-sdk/client-s3` (R2 é S3-compatível).
  - `LocalDriver` (dev) escrevendo em `./tmp/storage`.
- **Path layout:** `{workspace_id}/{year}/{month}/{day}/{uuid}.{ext}`
- **Bucket único** `highermind-media`. Sem ACL pública; tudo via signed URL.
- **Encryption:** R2 já criptografa em repouso. Não duplicar com AES manual (a menos que sensibilidade extrema; nesse caso campo `is_sensitive` e cifrar payload).
- **Signed URLs:** 1h padrão para visualização; 7 dias para download externo via API pública.

---

## 6. Message queue

### 6.1 Topologia RabbitMQ

Replicada do v1, com nomes harmonizados:

**Exchanges:**
- `hm.app` (topic) — eventos internos da aplicação
- `hm.channels` (topic) — eventos vindos de canais externos (Meta webhooks etc.)
- `hm.dlx` (topic) — Dead Letter Exchange para retry e DLQ

**Queues:**

| Queue | Bound em | Routing key | Consumer | TTL |
|---|---|---|---|---|
| `hm.q.inbound.message` | `hm.channels` | `inbound.message` | worker-inbound | — |
| `hm.q.inbound.media` | `hm.app` | `inbound.media` | worker-media | — |
| `hm.q.outbound.request` | `hm.app` | `outbound.request`, `outbound.retry` | worker-outbound | — |
| `hm.q.outbound.retry.10s` | `hm.dlx` | `outbound.retry` | (TTL → republish) | 10s |
| `hm.q.outbound.dlq` | `hm.dlx` | `outbound.dlq` | inspeção manual | — |
| `hm.q.socket.relay` | `hm.app` | `socket.*` | api server | — |
| `hm.q.campaign.followup` | `hm.app` | `campaign.followup` | worker-campaigns | — |
| `hm.q.flow.execution` | `hm.app` | `flow.execution` | worker-flows | — |
| `hm.q.webhook.dispatch` | `hm.app` | `webhook.dispatch` | worker-webhooks (ou worker-outbound) | — |

### 6.2 Padrão de mensagem

Toda mensagem RabbitMQ tem envelope padronizado:

```ts
type Envelope<T> = {
  schemaVersion: 1;
  type: string;                  // "inbound.message", "outbound.request", etc.
  workspaceId: string;
  correlationId: string;         // para tracing (= request-id)
  causationId?: string;          // evento causador (se aplicável)
  publishedAt: string;           // ISO timestamp
  attempt: number;               // contador de retries
  payload: T;
};
```

`schemaVersion` permite evolução; `correlationId` propaga através do socket relay e do log.

### 6.3 Retry e DLQ

- **Retry exponencial:** 3 tentativas com TTL crescente (10s, 60s, 300s) via 3 queues retry distintas.
- **DLQ inspecionável:** mensagens que falharam 3× vão pra `hm.q.outbound.dlq`. Admin panel mostra count + payload.
- **Idempotency:** consumidores devem ser idempotentes (usar `correlationId` como dedup key se necessário).

---

## 7. Real-time

- **Socket.io 4** + adapter `@socket.io/redis-adapter` (pub/sub Redis).
- **Rooms automáticas:** `member:{memberId}` e `workspace:{workspaceId}` ao autenticar.
- **Rooms por demanda:** `conversation:{id}` ao abrir uma conversa.
- **Sem socket nos workers:** workers publicam em `hm.q.socket.relay` via RabbitMQ; o API server consome e faz `io.to(room).emit(event, data)`. Mantém workers stateless.
- **Auth no handshake:** middleware Socket.io valida JWT cookie/header igual ao Express.
- **Tipagem:** `packages/shared/src/socket-events.ts` é o **source-of-truth canônico** de todos os eventos socket do sistema. Outros docs (LIVECHAT §6, DASHBOARD §5, INSTAGRAM §13) **citam** eventos relevantes mas não duplicam a definição:
  ```ts
  // packages/shared/src/socket-events.ts (SoT)
  export type ServerToClient = {
    // LiveChat
    'message:new': (payload: NewMessagePayload) => void;
    'message:status_changed': (payload: MessageStatusPayload) => void;
    'message:media_ready': (payload: MediaReadyPayload) => void;
    'conversation:updated': (payload: ConversationUpdatePayload) => void;
    'conversation:assigned': (payload: ConversationAssignedPayload) => void;
    'conversation:routing_changed': (payload: RoutingChangePayload) => void;
    'typing:from_contact': (payload: TypingPayload) => void;
    // Agents
    'agent_execution:started': (payload: AgentExecutionPayload) => void;
    'agent_execution:completed': (payload: AgentExecutionPayload) => void;
    // Flows
    'flow_execution:started': (payload: FlowExecutionPayload) => void;
    'flow_execution:cancelled': (payload: FlowExecutionPayload) => void;
    // Dashboard
    'dashboard:metric_changed': (payload: DashboardMetricPayload) => void;
    'dashboard:alert_raised': (payload: DashboardAlertPayload) => void;
    // Platform (super-admin only)
    'platform:incident_raised': (payload: PlatformIncidentPayload) => void;
  };
  ```

  Toda mudança em eventos passa por este arquivo; tipos são importados nos consumers (cliente, workers, frontend hooks).

---

## 8. Auth & multi-tenancy

### 8.1 Auth provider abstrato

```ts
// packages/shared/src/auth.ts
export interface IAuthProvider {
  verifyToken(token: string): Promise<AuthUser | null>;
  signIn(email: string, password: string): Promise<{ token: string; user: AuthUser }>;
  signOut(token: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  createUser(input: CreateUserInput): Promise<AuthUser>;
}

// apps/api/src/auth/supabase-adapter.ts (default)
export class SupabaseAuthAdapter implements IAuthProvider { /* ... */ }
```

Permite trocar Supabase Auth por Better-auth/Lucia/self-hosted sem mexer em rotas.

### 8.2 Roles e permissões

Cinco roles no v2 (simplificação dos 6 do v1):

| Role | Pode |
|---|---|
| `OWNER` | Tudo no workspace, inclusive billing e excluir workspace |
| `ADMIN` | Tudo exceto billing e excluir workspace |
| `SUPERVISOR` | Ver dashboards de todos, gerenciar deps/times, NÃO altera billing/inboxes |
| `AGENT` | Atender conversas atribuídas, ver pipeline relevante, sem admin |
| `READONLY` | Só leitura, sem ações |

Super-admin da plataforma é flag separada (`is_platform_admin` no `members`), não role.

### 8.3 RLS

Toda tabela com `workspace_id` tem RLS habilitada e policy padrão:

```sql
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_workspace_isolation ON conversations
  USING (workspace_id = current_setting('app.workspace_id')::uuid);
```

Middleware do Express seta `app.workspace_id` no início da transaction. Se esquecer, a query retorna 0 rows (fail-safe).

### 8.4 API key auth

API keys são SHA-256 hash em `api_keys` table com scopes (array de strings: `read:conversations`, `write:messages`, etc.). Rate limit por key (configurável por plano).

---

## 9. Workers em detalhe

### 9.1 Worker inbound

Consome `hm.q.inbound.message`. Despacho inicial **por provider** (`meta_whatsapp` | `meta_instagram` | `waha`); cada provider tem seu parser dedicado em `packages/channels/`. Para cada evento normalizado:

1. Parse + validate (Zod schema por provider — Meta WA, Meta IG, WAHA têm shapes diferentes).
2. Dedup via `webhook_events` table (`UNIQUE(channel_id, event_uid)`).
3. Identifica subtype do evento (DM normal, story mention, story reply, share, comment, postback, reaction, status callback — alguns só existem em IG).
4. Persist em `messages` table (ou `ig_comments` quando subtype = `comment`).
5. Para `comment_thread`: ensure/find conversation única por `(channel_id, media_id, contact_remote_id)` com `kind='comment_thread'`. Para `story_*`: persist com `metadata.story_id`.
6. Update `conversations` (last_message, last_message_at).
7. Se mídia (inclui attachments IG com URL temporária): publica em `hm.q.inbound.media` para download imediato (URL IG expira em ~5min).
8. Invalida cache da conversa (version bump).
9. Publica em `hm.q.socket.relay` para emit a `conversation:{id}` e `workspace:{workspaceId}`.
10. Se `conversation.ai_mode === 'on'`: enfileira em `hm.q.flow.execution` (com flow_id inferido) **ou invoca o agent-runtime Python via HTTP** (`POST agent-runtime:8001/agents/{agentId}/run`) com `workspace_id`, `policy_snapshot` (resolvido a partir de `workspace_agent_policies`), `conversation_id`, `contact_id`, `user_input`, `correlation_id`.
11. Se flow ativo `waiting_for_response`: chama `resumeFlowWithResponse`.

### 9.2 Worker outbound

Composição modular (mantém v1, melhorada):

```
parse → dispatch → process → finalize
```

- **parse:** valida envelope + payload Zod.
- **dispatch:** decide provider (Meta vs WAHA) e tipo (text/media/template/interactive).
- **process:** chama adapter do provider; trata erros tipados.
- **finalize:** atualiza `messages.view_status`, publica socket relay.

**Per-chat distributed lock** (FX-007): adquire `hm:lock:outbound:{conversationId}` com TTL 90s antes de processar. Garante FIFO por conversa.

### 9.3 Worker media

Idem v1: download via provider API → ffmpeg/sharp se converter → upload R2 → update `messages.media_*` → emit socket.

### 9.4 Worker campaigns

- Consome `hm.q.campaign.followup`.
- Cron interno via node-cron:
  - A cada 1min: busca `campaigns.status='running'` + `next_tick_at <= NOW()`. Distribui mensagens da campanha respeitando rate_limit_per_minute + send_windows + quality rating real-time.
  - A cada 1h: reset `messages_sent_today` se passou meia-noite no timezone do workspace.
- Idempotency: cada delivery tem `idempotency_key = sha256(campaign_id + contact_id + step_id)`.

### 9.5 Worker flows

- Consome `hm.q.flow.execution`.
- Invoca `@hm/flow-engine.processStep(executionId)`.
- Engine decide: SUCCESS → busca próxima edge e re-enfileira; WAITING → persiste `next_step_at`; COMPLETED/FAILED/CANCELLED → finaliza.
- Scheduler in-process (na API ou em worker dedicado) a cada 1min busca `flow_executions WHERE status='WAITING' AND next_step_at <= NOW()` e re-enfileira.

---

## 10. Agentes IA (LangGraph Python + OpenRouter)

Detalhado em [`AGENTS_LANGGRAPH.md`](./AGENTS_LANGGRAPH.md). Sumário:

- **Microsserviço `agent-runtime` em Python** (FastAPI + LangGraph + LangServe). Stateless, escalável horizontalmente.
- **Cliente Node:** `packages/agents-client/` expõe `runAgent(input)` que retorna `AsyncGenerator<AgentStreamEvent>`. Internamente faz `POST agent-runtime:8001/agents/{agentId}/run` com `Authorization: Bearer ${AGENT_RUNTIME_TOKEN}` e consome SSE.
- **LLM via OpenRouter:** chamadas chat completion vão para `https://openrouter.ai/api/v1/chat/completions` com `Authorization: Bearer ${OPENROUTER_API_KEY}` (api key da plataforma, NÃO por workspace). Modelo escolhido em `agent.model` (slug OpenRouter).
- **StateGraph** com nodes: `load_context → build_prompt → call_model → tool_dispatch → finalize`.
- **Conditional edge** `should_continue_loop` (model retornou tool_calls? E iteration < policy.max_iterations?).
- **PostgresCheckpointer** (`langgraph.checkpoint.postgres`) salva state no mesmo Postgres do Highermind (schema `langgraph_*`).
- **Tools híbridas:**
  - **"Leves" (Python):** `query_contact`, `query_conversation`, `search_knowledge_base` — Python conecta direto ao Postgres com workspace context (`SET LOCAL app.workspace_id`) e column-level ACL aplicado.
  - **"De negócio" (callback Node):** `transfer_to_human`, `trigger_flow`, `move_deal_stage`, `schedule_event`, `mark_resolved` — Python faz `POST api:3001/internal/tools/{toolKey}` com token interno; Node executa e retorna resultado JSON.
- **Policy enforcement:** antes de invocar o grafo, agent-runtime aplica `policy_snapshot` recebido na requisição: filtra `tools` para subset permitido, ajusta `max_iterations`, bloqueia modelos fora da whitelist, valida cap de custo restante.
- **Streaming SSE** proxy: API Node mantém conexão SSE com o frontend e simplesmente repasse os eventos da resposta SSE da agent-runtime, sem buffering.
- **Auditoria de uso:** cada `call_model` registra `llm_usage_logs` (workspace_id, agent_id, conversation_id, model, openrouter_generation_id, prompt_tokens, completion_tokens, cost_usd, latency_ms) com INSERT direto no Postgres.

---

## 11. Frontend

### 11.1 Stack

- **Next.js 15+** (App Router) com **React 19** e Turbopack como dev server
- **Server Components por default;** `'use client'` apenas em componentes com estado/socket/dnd/animação
- **Tailwind 4** (CSS-only utilities)
- **TanStack Query 5** (cache client-side; SSR hydration suportado via `HydrationBoundary`)
- **Zustand** (state global cliente: auth-snapshot, theme, subscription)
- **React Hook Form + Zod** (forms client-side; **Server Actions** para mutations simples sem state local)
- **@xyflow/react** (Flow Builder — client-only via `dynamic(() => import(...), { ssr: false })`)
- **@fullcalendar/\*** (calendar — client-only)
- **@dnd-kit/\*** (pipeline drag-and-drop — client-only)
- **recharts** (gráficos — client-only)
- **socket.io-client** (real-time — client-only, em provider de root layout)
- **Motion One** (animações leves)
- **next/font** (carregamento otimizado de Rajdhani / Chakra Petch / Orbitron / Manrope)
- **next/image** (com loader customizado apontando para R2)

### 11.2 Estrutura App Router

```
apps/web/
├── app/
│   ├── layout.tsx                    # root layout: providers (Query, Theme, Socket, Toast); fontes via next/font
│   ├── globals.css                   # reset + import tokens DS v2
│   ├── (auth)/                        # route group SEM URL prefix
│   │   ├── layout.tsx                # layout enxuto (centrado, sem sidebar)
│   │   ├── login/page.tsx
│   │   └── reset-password/page.tsx
│   ├── (app)/                         # route group autenticado (sidebar + topbar)
│   │   ├── layout.tsx                # AppLayout — verifica sessão server-side
│   │   ├── page.tsx                  # dashboard inicial
│   │   ├── conversations/
│   │   │   ├── page.tsx              # inbox (Server Component lista; ChatList interativa em client)
│   │   │   └── [id]/page.tsx         # detalhe (server-fetched snapshot + client live updates via socket)
│   │   ├── agents/
│   │   │   ├── page.tsx
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/
│   │   │       ├── page.tsx
│   │   │       ├── playground/page.tsx
│   │   │       └── tools/page.tsx
│   │   ├── flow-builder/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx          # editor ReactFlow (dynamic import client-only)
│   │   ├── pipeline/page.tsx
│   │   ├── campaigns/
│   │   │   ├── page.tsx
│   │   │   ├── new/page.tsx           # multi-step wizard
│   │   │   └── [id]/page.tsx
│   │   ├── calendar/page.tsx
│   │   ├── contacts/page.tsx
│   │   ├── settings/                  # rotas aninhadas
│   │   │   ├── workspace/page.tsx
│   │   │   ├── members/page.tsx
│   │   │   ├── channels/page.tsx
│   │   │   ├── agents/page.tsx
│   │   │   └── ...
│   │   ├── dashboard/page.tsx
│   │   └── platform/                  # super-admin (gate: is_platform_admin)
│   │       ├── workspaces/page.tsx
│   │       ├── llm-models/page.tsx
│   │       ├── agent-policies/page.tsx
│   │       ├── secrets/page.tsx
│   │       └── infra/page.tsx
│   └── api/                           # uso mínimo: signed upload URL, healthz
│       ├── healthz/route.ts
│       └── uploads/signed-url/route.ts
├── features/                          # lógica por domínio (NÃO rotas)
│   ├── conversations/
│   │   ├── components/                # client components ('use client')
│   │   │   ├── ChatList.tsx
│   │   │   ├── ConversationPanel.tsx
│   │   │   ├── MessageBubble/
│   │   │   └── MessageComposer.tsx
│   │   ├── server/                    # server-only data fetching utils
│   │   │   └── load-conversations.ts
│   │   ├── hooks/                     # client hooks ('use client')
│   │   ├── queries.ts                 # TanStack queryKeys + fetchers
│   │   └── types.ts
│   ├── agents/
│   ├── flow-builder/
│   ├── pipeline/
│   ├── campaigns/
│   ├── calendar/
│   ├── contacts/
│   ├── settings/
│   └── platform-admin/
├── shared/
│   ├── components/                    # primitives DS v2 (Button, Input, Modal, Toast, Card, Badge, Tabs, Popover...)
│   │   └── ui/                        # base; client/server agnóstico quando possível
│   ├── hooks/                         # 'use client'
│   ├── lib/
│   │   ├── api-client.ts              # fetch wrapper tipado (server + client)
│   │   ├── query-client.ts            # 'use client'
│   │   ├── socket.ts                  # 'use client'
│   │   ├── supabase-server.ts         # cookies() + middleware auth
│   │   └── supabase-browser.ts        # 'use client'
│   └── icons/
├── middleware.ts                      # auth check em /(app)/* via cookie Supabase
├── next.config.mjs                    # output: 'standalone' (Docker); images.remotePatterns p/ R2
├── tailwind.config.ts
├── postcss.config.mjs
└── package.json
```

### 11.3 Padrões de data fetching

**Decisão arquitetural (ADR-025):** Server Components do `apps/web` **NÃO** acessam Postgres direto. Em vez disso, fazem `fetch('http://api:3001/...')` na rede Docker interna pra API Node, que é dona de TODA lógica de auth + RLS + queries. Trade-off: 1 hop HTTP extra (~5-15ms na LAN); ganho: zero duplicação de lógica de domínio entre `apps/web` e `apps/api`, RLS Postgres continua centralizado no mesmo middleware Express já existente, schema do DB acessível por um lugar só.

Implicações concretas:

- `apps/web` **NÃO importa** `packages/db` em runtime. Pode importar tipos (`type Conversation from '@hm/db'`) para tipagem, mas não conexão.
- Cliente API (`apps/web/shared/lib/api-client.ts`) tem variante server (`createServerClient()`) que injeta cookie da sessão no header `Authorization` automaticamente — Express valida normalmente.
- Server Components recebem dados já filtrados por RLS (a API faz). Próxima virada: o **mesmo** code path serve client components via TanStack Query e Server Components via fetch direto.
- Server Actions (`'use server'`) também chamam apps/api por HTTP, não escrevem direto no DB.

Duas camadas:

**Server Components (fetch via cliente HTTP server-side — preferido pra páginas):**

```tsx
// app/(app)/conversations/page.tsx — Server Component
import { createServerApiClient } from '@/shared/lib/api-client';
import { ChatList } from '@/features/conversations/components/ChatList';
import { QueryClient, dehydrate, HydrationBoundary } from '@tanstack/react-query';

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const api = await createServerApiClient();           // injeta cookie de sessão automaticamente
  const initialData = await api.conversations.list({ status });  // HTTP → apps/api → Drizzle + RLS

  const qc = new QueryClient();
  await qc.prefetchQuery({
    queryKey: ['conversations', { status }],
    queryFn: () => initialData,
  });

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ChatList />
    </HydrationBoundary>
  );
}
```

**Por dentro do `createServerApiClient()`:**

```ts
// apps/web/shared/lib/api-client.ts
import 'server-only';
import { cookies } from 'next/headers';

export async function createServerApiClient() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('hm-session')?.value;
  const baseUrl = process.env.INTERNAL_API_URL ?? 'http://api:3001';   // DNS Docker; em dev: http://localhost:3001

  return {
    conversations: {
      list: (filters: ListFilters) => fetch(`${baseUrl}/api/conversations?${qs.stringify(filters)}`, {
        headers: { Cookie: `hm-session=${sessionCookie}` },
        next: { revalidate: 0 },   // sem cache no edge; Next só usa pra dedupe na request
      }).then(r => r.json()),
      get: (id: string) => fetch(/* ... */),
      // ...
    },
    agents: { /* ... */ },
    // ...
  };
}
```

**Client Components (real-time + interatividade):**

```tsx
// features/conversations/components/ChatList.tsx
'use client';
import { useQuery } from '@tanstack/react-query';
import { useChatSocket } from '../hooks/useChatSocket';

export function ChatList() {
  const { data } = useQuery({
    queryKey: ['conversations', filters],
    queryFn: () => api.conversations.list(filters),
    staleTime: 30_000,
  });
  useChatSocket(/* invalida queries em events */);
  return /* ... */;
}
```

Realtime via `useChatSocket(conversationId)` — hook client-only que conecta ao Socket.io e dispara `queryClient.invalidateQueries` no evento certo.

### 11.4 Forms

`'use client'` + React Hook Form + Zod:

```tsx
// features/agents/components/CreateAgentForm.tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

const schema = z.object({
  name: z.string().min(2),
  model: z.string(),    // slug OpenRouter; validado contra policy server-side
  systemPrompt: z.string().min(10),
});

export function CreateAgentForm({ allowedModels }: { allowedModels: string[] }) {
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const mutation = useCreateAgent();
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(mutation.mutate)}>
        {/* model picker filtrado por allowedModels (vem do server component pai) */}
      </form>
    </Form>
  );
}
```

Para mutations triviais (toggle de flag, delete simples) considerar **Server Actions** (`'use server'`) — elimina round-trip pela API e simplifica forms sem state.

### 11.5 Code splitting

App Router faz code splitting automático **por rota**. Componentes pesados (`@xyflow/react`, `@fullcalendar/*`, `recharts`) são carregados via `next/dynamic` com `ssr: false`:

```tsx
const FlowEditor = dynamic(() => import('@/features/flow-builder/components/FlowEditor'), { ssr: false });
```

Não precisa de `manualChunks` manual; o Next + Turbopack gerencia.

### 11.6 i18n

Estrutura preparada (default `pt-BR`, locale resolvido no server via `members.locale_override` > `workspaces.locale`); biblioteca `next-intl` (compatível com App Router + Server Components). **MVP entrega só pt-BR.** Adicionar idioma novo no futuro = dictionary + ajuste de roteamento; sem refactor.

### 11.7 Tema

- `data-theme="dark|light"` no `<html>`. Default dark.
- `ThemeProvider` é Client Component com Zustand persist em localStorage + sync com backend (`PATCH /api/me/theme`).
- **Sem flash:** script inline no `<head>` do `app/layout.tsx` lê localStorage e aplica `data-theme` antes do hydrate (próprio do RSC, executa antes da hidratação do React).

### 11.8 Auth via middleware

```ts
// apps/web/middleware.ts
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  const supabase = createServerClient(/* env */);
  const { data: { session } } = await supabase.auth.getSession();

  const isApp = req.nextUrl.pathname.startsWith('/(app)') || /* outros gates */;
  if (isApp && !session) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/healthz).*)'],
};
```

Server Components dentro de `/(app)/` confiam que a sessão existe (middleware garante). Tools como `apps/web/shared/lib/supabase-server.ts` retornam o user.

### 11.9 Build e runtime

- **Dev:** `pnpm --filter @hm/web dev` → `next dev --turbo` na porta `3000`.
- **Build:** `pnpm --filter @hm/web build` → `next build` (output: `'standalone'`).
- **Runtime container:** `node .next/standalone/server.js` na porta 3000. Container `web` no `docker-compose.prod.yml` (vide INFRASTRUCTURE §1.2).
- **Nginx:** `proxy_pass http://web:3000` para `app.<domínio>`.

---

## 12. Observability

### 12.1 Logger

- Pino structured logger em todo backend.
- Convenção: `logger.info({ event: 'message.persisted', conversationId, ms }, 'log msg')`.
- PII masking automático em campos: email, phone, password, token, secret, api_key, authorization, cookie.
- Log levels: development=`debug`, production=`info`.
- Sink default: stdout (Docker captura). Em produção opcional: forward para Loki/Logtail.

### 12.2 Tracing

- OpenTelemetry SDK em todos os processos.
- Auto-instrumentation: HTTP, Postgres, Redis, RabbitMQ.
- Manual spans em pontos críticos: agent execution, flow step, outbound dispatch.
- Exporter padrão: OTLP HTTP. Coletor configurável (Honeycomb, Tempo, Jaeger).
- `correlationId` propagado via trace context (W3C traceparent).

### 12.3 Metrics

- OpenTelemetry metrics: counters (messages_sent, agent_invocations), histograms (latency p50/p95/p99 por rota e por handler).
- Exporter padrão: OTLP HTTP. Coletor configurável.

### 12.4 Errors

- Sentry SDK opcional (env `SENTRY_DSN`); se ausente, fallback para `logger.error`.
- Errors estruturados: classes derivando de `AppError` com `code`, `statusCode`, `metadata`.

---

## 13. Segurança

Detalhado em `MIGRATION_NOTES.md §"Segurança"`. Sumário:

- **TLS 1.3 obrigatório.** Nginx termina; backend é HTTP local.
- **Webhook signature verification:** Meta usa `x-hub-signature-256` calculado com **app_secret** (compartilhado WA + IG no mesmo Meta App). Validar SEMPRE, antes de qualquer parse.
- **Webhook único `/webhooks/meta`** despacha por `object` (`whatsapp_business_account` | `instagram`). Verify token único da plataforma; channel secrets ficam só para outbound (access tokens).
- **Webhook rate limit:** middleware por IP no `/webhooks/*`.
- **Auth cache com SHA-256:** nunca armazenar token em texto plano em Redis.
- **Service-to-service auth:** Node ↔ agent-runtime Python usam token compartilhado (`AGENT_RUNTIME_TOKEN`) em header `Authorization: Bearer <token>`. Token rotacionável via env. Conexão acontece em rede Docker interna (não exposta no Nginx).
- **Tools callback Node ← Python:** Python autentica com mesmo token; Node valida + extrai `workspace_id` do payload assinado.
- **Secrets em vault:** `.env` na VPS com permission 0600. Não commitar. Platform-level secrets (OpenRouter API key, Meta App Secret, etc.) também armazenados cifrados em `platform_secrets` com versionamento para rotação.
- **RLS desde o primeiro migration.** Agent-runtime Python aplica `SET LOCAL app.workspace_id = <id>` no início de cada transaction com o Postgres.
- **PII masking em logs.** Em Python idem (formatter loguru com regex redact).
- **Encryption at rest:** mídia via R2 (gerenciado); secrets em DB cifrados com AES-256-GCM (mantém `lib/crypto.ts` do v1 com key versioning).
- **Rate limit:** express-rate-limit em rotas sensíveis (login, reset password, send_message) + por API key + por workspace + **por chamada de agent (per-workspace cost cap)**.
- **Input validation:** Zod em TODA rota Node antes do handler; Pydantic v2 em TODA rota Python.
- **SQL injection:** Drizzle (Node) e SQLAlchemy/asyncpg com parametrização (Python). Nunca template literal SQL.
- **XSS:** React escapa por padrão; `dangerouslySetInnerHTML` proibido a menos que sanitizado via DOMPurify.
- **CSRF:** SameSite=Lax + double-submit cookie em mutações.
- **App Review Meta:** runbook obrigatório (`docs/runbooks/meta-app-review-instagram.md`). Permissões IG (`instagram_manage_messages`, `instagram_manage_comments`) com justificativa documentada por uso real.

---

## 14. CI/CD

### 14.1 GitHub Actions

```yaml
.github/workflows/
├── ci.yml             # rodam em PR: lint, typecheck, build, test, e2e
├── deploy.yml         # roda em push main: build images, push GHCR, ssh VPS
└── nightly.yml        # rodam noite: full e2e, dependency audit
```

### 14.2 Branch protection

- `main` protegida: requer 1 review + CI verde + linear history.
- Push direto bloqueado via git hook local (`scripts/git-hooks/pre-push`) e via branch protection (quando o plano upgrade).
- Hotfix exige PR.

### 14.3 Deploy

- Builds geram imagens `ghcr.io/highermind/api:sha` etc.
- `deploy.yml` faz SSH na VPS, pull imagens, `docker compose up -d --no-deps`.
- Health check em cada serviço; rollback automático se falha.

---

## 15. Performance budget

| Métrica | Budget |
|---|---|
| FCP (web) | < 1.5s |
| TTI (web) | < 3s |
| Initial bundle gzipped | < 250KB |
| API P95 latency (`/conversations` list) | < 200ms |
| API P95 latency (`/messages/send`) | < 500ms |
| Agent first token (streaming) | < 2s |
| Inbound webhook → mensagem renderizada | < 1s |
| Postgres slow query log threshold | > 100ms |
| Redis hit rate (conversation cache) | > 90% |

---

## 16. Anti-patterns proibidos

(Aprendidos do v1; ver `MIGRATION_NOTES.md` para detalhes)

- ❌ `any` em código de produção
- ❌ Cast `as unknown as Foo` para suprimir tipo
- ❌ `console.log` em código de produção (use logger)
- ❌ Hex hardcoded em JSX (use tokens DS)
- ❌ Migration SQL ad-hoc fora da pipeline de migrations
- ❌ Script `check_*.ts` em `apps/api/src/` (pertence a `scripts/`)
- ❌ Mock de DB em integration test (use Postgres real via testcontainers)
- ❌ `--no-verify` em git commit
- ❌ Push direto em main
- ❌ `class XService` quando uma função pura serve
- ❌ Workspace separado para cadastro/landing/landing-marketing (MVP só `apps/web`)
- ❌ Componente Toast/Button/Modal duplicado em pastas diferentes
- ❌ Cache key como string interpolada solta; deve passar pelo builder em `packages/db/src/cache/keys.ts`

---

## 17. Próximos passos

1. Rogério aprova esta arquitetura.
2. `/hm-init` materializa essa estrutura num diretório novo.
3. Roadmap em [`ROADMAP.md`](./ROADMAP.md) define ordem de implementação.
4. Primeiro slot: F0-S01 (fundação) — setup do monorepo, CI/CD, schema base, auth, workspace.

---

> Mudanças nesta arquitetura exigem ADR (`docs/decisions/`). Não mudar silenciosamente.
