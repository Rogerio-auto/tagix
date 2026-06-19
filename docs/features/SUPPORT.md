# SUPPORT — Suporte ao Cliente (Leadium)

> **Fase:** F38 · **Status:** spec aprovada 2026-06-18
> **Fonte de verdade** dos slots `tasks/slots/F38/*`.
> Três pilares: **Central de Ajuda (CMS)**, **Chat ao Vivo com o Suporte**, **Portal do Desenvolvedor + novos endpoints**.

---

## 0. Contexto e princípios

Leadium não tem nenhuma superfície de ajuda/suporte hoje. A nav lateral tem 9 itens + Configurações. A API pública v1 existe (`apps/api/src/routes/v1/`, OpenAPI 3.1 gerado do Zod, Swagger cru em `/api/v1/docs`) mas sem portal legível. Esta fase entrega a camada de **suporte ao usuário do Leadium** (membros do workspace) — não é suporte white-label para os clientes finais de cada workspace (isso é fase futura).

Princípios herdados do CLAUDE.md: world-class, DS v2 nativo (zero hex em JSX), TS strict zero `any`, RLS desde o schema, Zod em toda input externa, testes acompanham o código.

**Decisões travadas (aprovadas pelo Rogério):**

1. **Público:** usuários do Leadium (membros do workspace). Conteúdo de ajuda é escrito pela equipe Leadium (platform-level), lido por todos os workspaces.
2. **Suporte:** self-service **+ chat ao vivo** com a equipe Leadium, reusando a infra de Socket.io existente (canal interno, **não** passa por Meta/WhatsApp).
3. **Conteúdo:** **CMS no painel super-admin** — artigos persistidos em DB, publicáveis sem deploy.
4. **API:** **portal de docs polido in-product** (DS v2, renderizado do OpenAPI) **+ novos endpoints** na API pública v1.
5. **Render de artigo:** Markdown/MDX **sanitizado** (sem HTML cru arbitrário, sem componentes React arbitrários injetados no corpo). Segurança > flexibilidade.

---

## 1. Pilar A — Central de Ajuda (CMS + leitor)

### 1.1 Modelo de dados (platform-level)

O conteúdo de ajuda é **global** (sem `workspace_id`), seguindo o padrão de `platform_secrets`: sem RLS de tenant; **escrita** gated por `requirePlatformAdmin`; **leitura** liberada a qualquer membro autenticado (apenas `status='published'`).

- **`help_categories`** — `id`, `slug` (unique), `title`, `description`, `icon` (lucide key), `order int`, `created_at`, `updated_at`.
- **`help_articles`** — `id`, `category_id` (fk), `slug` (unique), `title`, `excerpt`, `body_md text` (Markdown), `status` (`draft|published`), `order int`, `anchor_key text null` (chave estável para deep-link do help contextual `(?)`, ex.: `agents.create`), `published_at`, `created_by` (member id), `updated_by`, `created_at`, `updated_at`.
- **`help_article_feedback`** — **este é workspace-scoped** (sinal por workspace): `id`, `article_id` (fk), `workspace_id` (fk, RLS de tenant), `member_id`, `helpful boolean`, `comment text null`, `created_at`. UNIQUE `(article_id, member_id)` (último voto sobrescreve).

Índices: FTS em `help_articles(title, excerpt, body_md)` via `tsvector` (português) para a busca. `help_articles(status, category_id, order)`.

### 1.2 API

- **CMS (platform-admin)** — `apps/api/src/routes/platform/help.ts`, montado sob o gate `requirePlatformAdmin`: CRUD categorias + artigos, `publish`/`unpublish`, reorder.
- **Leitor (membro autenticado)** — `apps/api/src/routes/help.ts`: `GET /api/help/categories` (com contagem de artigos publicados), `GET /api/help/articles?category=&q=` (busca FTS), `GET /api/help/articles/:slug`, `GET /api/help/articles/by-anchor/:anchorKey`, `POST /api/help/articles/:id/feedback`.

### 1.3 UI

- **CMS** em `(platform)`: `apps/web/app/(platform)/platform/help/` + `apps/web/features/platform-admin/help/` — lista de categorias/artigos, editor Markdown (preview ao vivo, sanitizado), workflow draft→published, reorder.
- **Leitor** em `(app)`: `apps/web/app/(app)/help/` + `apps/web/features/help/` — home com categorias, busca, view de artigo (render sanitizado), feedback "isso ajudou?". Nova entrada na nav `Ajuda` (sem `perm` — visível a todos).
- **Help contextual `(?)`**: primitive `HelpHint`/`HelpPopover` em `@hm/ui` que recebe um `anchorKey`, busca o artigo por âncora e abre em popover/sheet com link "ver artigo completo". Plugado nos headers de um conjunto curado de features.

---

## 2. Pilar B — Chat ao Vivo com o Suporte

Canal **interno** entre o membro do workspace e a equipe Leadium (platform admins). Não usa Meta/WhatsApp; usa o Socket.io já configurado.

### 2.1 Modelo de dados

- **`support_threads`** — `id`, `workspace_id` (RLS de tenant: membro vê só os do seu workspace; platform-admin faz bypass), `opened_by` (member id), `subject`, `status` (`open|pending|resolved`), `priority` (`low|normal|high`), `assigned_to` (platform member id, null), `last_message_at`, `created_at`, `updated_at`.
- **`support_messages`** — `id`, `thread_id` (fk), `sender_type` (`member|platform`), `sender_id`, `body text`, `attachments jsonb` (signed URLs via storage existente, opcional), `created_at`.

RLS: `support_threads`/`support_messages` filtram por `workspace_id` do membro; platform-admin lê/escreve tudo (mesma postura do inbox cross-workspace dos painéis platform já existentes).

### 2.2 API

- **Membro** — `apps/api/src/routes/support.ts`: `POST /api/support/threads` (abrir), `GET /api/support/threads` (meus), `GET /api/support/threads/:id` (+ mensagens), `POST /api/support/threads/:id/messages`, `POST /api/support/threads/:id/resolve`. Reusar `assertThreadVisible` (padrão de `assertConversationVisible` da F30) → 404 fora do escopo.
- **Plataforma** — `apps/api/src/routes/platform/support.ts` (gate `requirePlatformAdmin`): `GET` lista cross-workspace com filtros (status/priority/workspace), `POST .../messages` (reply), `PATCH .../:id` (status/priority/assign).

### 2.3 Real-time

Rooms Socket.io: `support:thread:<id>` (participantes do thread) + `support:platform` (todos os platform admins, recebem novos threads/mensagens). Relay via o mesmo padrão de `hm.q.socket.relay`/`io.emit` já usado em conversas. Eventos: `support:message`, `support:thread_updated`.

### 2.4 UI

- **Membro** em `(app)`: launcher "Falar com suporte" dentro da Central de Ajuda (`apps/web/features/support/`) — lista de threads + view de chat real-time. Sem nova entrada de nav top-level (vive sob `/help`).
- **Plataforma** em `(platform)`: inbox de suporte (`apps/web/features/platform-admin/support/` + `apps/web/app/(platform)/platform/support/`) — triagem, filtros, reply real-time, status/priority/assign.

---

## 3. Pilar C — Portal do Desenvolvedor + novos endpoints

### 3.1 Novos endpoints API pública v1

Estendem `apps/api/src/routes/v1/` (Zod em `schemas.ts`, rota em `index.ts`, registro em `openapi.ts`, scope em `API_SCOPES`, teste em `routes.test.ts`). Conjunto aprovado:

| Endpoint | Método | Scope |
|---|---|---|
| `list_contacts` | `GET /api/v1/contacts` | `contacts:read` |
| `get_contact` | `GET /api/v1/contacts/:id` | `contacts:read` |
| `send_media` | `POST /api/v1/messages/media` | `messages:write` |
| `list_deals` | `GET /api/v1/deals` | `deals:read` |
| `get_deal` | `GET /api/v1/deals/:id` | `deals:read` |
| `move_deal_stage` | `POST /api/v1/deals/:id/move` | `deals:write` |
| `create_conversion` | `POST /api/v1/conversions` | `conversions:write` |
| `list_conversions` | `GET /api/v1/conversions` | `conversions:read` |
| `list_flows` | `GET /api/v1/flows` | `flows:read` |
| `list_events` / `create_event` | `GET`/`POST /api/v1/events` | `calendar:read` / `calendar:write` |

Todos reusam serviços/repos existentes; nada de lógica nova de negócio — só superfície de API + validação + scope + paginação consistente com os endpoints v1 atuais.

### 3.2 Portal do Desenvolvedor (in-product)

`apps/web/app/(app)/help/developers/` + `apps/web/features/developers/`. DS v2, **não** Swagger cru. Seções: **Getting Started**, **Autenticação** (API key, deep-link para Settings → Dev), **Referência** (renderizada do `/api/v1/docs` JSON — agrupada por recurso, com request/response e scopes), **Webhooks** (assinatura HMAC, payloads, retry), **Exemplos** (snippets copy-paste em curl / JS / Python). Título e branding = **Leadium API**.

---

## 4. Decomposição em slots (F38)

| Slot | Título | Agente | Tam | Depende |
|---|---|---|---|---|
| F38-S01 | Schema Help + Support (5 tabelas) + RLS + repos + seed | db-engineer | L | — |
| F38-S02 | API CMS Help Center (CRUD + publish), platform-admin | backend | M | S01 |
| F38-S03 | API leitor de ajuda (list/get/anchor + busca FTS + feedback) | backend | M | S01 |
| F38-S04 | UI CMS Help no `(platform)` (lista + editor MD + publish) | frontend | M | S02 |
| F38-S05 | UI leitor `/help` + entrada de nav "Ajuda" | frontend | M | S03 |
| F38-S06 | Help contextual `(?)` (`HelpHint` em `@hm/ui` + anchors) | frontend | M | S05 |
| F38-S07 | API suporte do membro (abrir/listar/responder/resolver) | backend | M | S01 |
| F38-S08 | Real-time suporte (Socket.io rooms + relay) | backend | M | S07 |
| F38-S09 | UI launcher + chat de suporte no `(app)` | frontend | M | S07, S08 |
| F38-S10 | API inbox de suporte no `(platform)` (triagem/reply/status) | backend | M | S07, S08 |
| F38-S11 | UI inbox de suporte no `(platform)` (real-time) | frontend | M | S10 |
| F38-S12 | Novos endpoints API pública v1 + OpenAPI + scopes + testes | backend | L | — |
| F38-S13 | Portal do Desenvolvedor in-product (DS v2, render do OpenAPI) | frontend | L | S12 |
| F38-S14 | QA da fase (integration + e2e happy paths) | qa-engineer | M | todos |
| F38-S15 | Auditoria de segurança da fase (RLS, gates, XSS MD, scopes) | security-auditor | M | todos |

**Paralelismo:** wave 1 = S01 + S12 (independentes). Após S01: S02/S03/S07. Após S07: S08/S10. UIs seguem suas APIs. S14/S15 fecham.

---

## 5. Riscos / cuidados

- **XSS no corpo do artigo:** render Markdown **sanitizado** (allowlist de tags; sem `<script>`/`<iframe>`/handlers inline). Teste de segurança obrigatório no S15.
- **Vazamento cross-workspace em support_threads:** `assertThreadVisible` em todo endpoint `/:id/*` → 404 (não 403) fora do escopo. Espelha a correção IDOR da F30.
- **Migration journal:** S01 é o único slot de schema da fase (help + support juntos) para evitar colisão no `meta/_journal.json`.
- **Barrel `@hm/shared`:** exports explícitos (gotcha F34) — coordenar edições do `index.ts` entre slots backend.
- **Nome do produto:** **Leadium** em toda string product-facing (inclui título do OpenAPI / portal). Sem "Tagix" em artefato novo.

---

## 6. F41 — Portal do Desenvolvedor: Referência rica + Console "Try it"

Extensão do portal (F38-S13), 100% frontend em `apps/web/features/developers/**`. O OpenAPI em `/api/v1/openapi.json` já expõe os schemas (Zod-derived); o modo real reusa a `/api/v1` existente (API key + CORS já libera `Authorization`). **Nenhuma mudança de backend.**

### 6.1 Referência por endpoint (gap do S13)
Hoje a referência mostra só método + path + summary + scope. Adicionar, por endpoint: **request body** (campos, tipos, obrigatórios), **parâmetros** (path/query), **response** (schema), e um **exemplo de requisição gerado do schema** (curl/JS/Python) — substituindo o `snippets.ts` hardcoded por um gerador. Resolver `$ref` para `components.schemas`.

### 6.2 Console "Try it"
Painel de execução por endpoint com toggle **Sandbox (default) / Real**:
- **Sandbox:** mock **client-side** gerado do response schema. Disponível para TODOS os endpoints (inclusive mutações). **Nunca faz request de rede, nunca toca dado real.**
- **Real:** o cliente cola uma **API key (Bearer)**; o browser chama `/api/v1` direto, escopado ao workspace da chave pelo backend. **Somente GET.** Endpoints de escrita/efeito (`send_message`, `move_deal_stage`, etc.) ficam **bloqueados no modo real** (com aviso) e só executam no Sandbox. A key vive **só em memória** (nunca persistida/logada).

### 6.3 Os dois muros do "não misture" (inegociável)
1. **Sandbox ⟂ dado real:** sandbox é mock puro client-side; jamais emite request nem escreve.
2. **Escopo do tenant:** o console é estritamente do workspace do cliente (modo real usa a key dele, isolada por RLS no backend). Nada de endpoints/dados de plataforma (equipe Leadium), nada cross-tenant. Mutações reais impossíveis pelo console.
</content>
</invoke>
