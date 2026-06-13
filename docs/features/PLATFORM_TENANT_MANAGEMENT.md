# Feature — PLATFORM TENANT MANAGEMENT & AI OPS

> **Documento:** plano de produto + arquitetura para expandir o painel de super-admin (F2.5/F25)
> para gestão completa por tenant: 360º do workspace, assinaturas/planos, **view-as (impersonation)**
> e **playground isolado de agentes**.
> **Audiência:** Rogério (super-admin/CTO) + quem decompõe (`/hm-tasks`) e implementa.
> **Status:** PROPOSTA (aguarda decisões de escopo — §9). Fase sugerida: **F26 (encoding de "F2.6")**.
> **Padrão de referência:** back-offices internos de Stripe, Vercel, AWS, Linear, Intercom, Auth0.

---

## 1. Por que (framing big-tech)

Toda plataforma multi-tenant madura tem um **back-office** separado do produto, onde o operador
da plataforma (nós) administra os tenants sem entrar no código nem no banco. Os padrões consagrados:

| Padrão big-tech | Referência | O que resolve | Nosso equivalente |
|---|---|---|---|
| **Tenant 360 / Account page** | Stripe Customer, Intercom Workspace | Tudo de UM tenant numa tela: plano, uso, membros, saúde, audit | **Workspace 360** (§4) |
| **Plans + Entitlements + overrides** | Stripe Products/Prices, LaunchDarkly, AWS Service Quotas | Planos como bundles de limites/features + override por conta ("custom/grandfathered") | **Planos & Assinaturas** (§5) |
| **Impersonation / "View as / Login as"** | Stripe "view as account", Intercom, Auth0, Zendesk | Suporte/debug vendo exatamente o que o cliente vê — **com guardrails** | **View-as** (§6) |
| **Sandbox / Test mode / Playground** | OpenAI Playground, Stripe test mode, Vercel preview | Testar config sem efeito em produção | **Agent Playground** (§7) |
| **Audit & Action log** | todos | Quem fez o quê, quando, em qual tenant | já temos `audit_logs` (estender) |

O que diferencia o nível big-tech NÃO é ter essas telas — é o **rigor de segurança e isolamento**:
impersonation time-boxed/auditada, sandbox sem side-effects, secrets nunca expostos, tudo logado.
Este doc trata cada um desses como requisito de primeira classe, não afterthought.

---

## 2. O que já temos (fundação — não rebuildar)

- **Painel F25** (`apps/web/app/(platform)/platform/**` + `features/platform-admin/**`): route group
  dedicado, guard `requirePlatformAdmin` (API + edge middleware), `lib/` (client/guard/types), 4 páginas
  (Modelos, Políticas, Secrets, Uso) e 4 routers gated.
- **Billing schema (BILLING_ENABLED=false):** `plans` (key, name, price_monthly/yearly_cents, `limits` jsonb,
  `features` jsonb, stripe_product/price IDs, is_active, position) · `subscriptions` (status, billing_cycle,
  trial_ends_at, stripe_customer_id…) · `workspaces.{plan_id, trial_ends_at, subscription_status}`
  (trial/active/past_due/canceled/expired).
- **AI governance:** `workspace_agent_policies` (allowed_models, flags LangGraph, caps), `llm_models_whitelist`
  (global), `llm_usage_logs` (custo por chamada). APIs F25 já gerenciam isso.
- **Agent runtime:** `POST /run` (LangGraph + OpenRouter, stream SSE), `agents`/`agent_templates`/`agent_tools`/
  `agent_executions`. PRD §80 já especifica o **playground isolado** como feature.
- **Identidade/auth:** `members.is_platform_admin`, sessão expõe `isPlatformAdmin`, `audit_logs` com
  actor_type `platform_admin`. Auth atrás de `IAuthProvider` (Supabase).
- **RLS multi-tenant:** tudo workspace-scoped roda sob `withWorkspace(workspaceId, tx)`; a camada plataforma
  roda como owner (sem RLS) e o guard é a fronteira.

**Gaps reais a construir:** (a) UI/agregação de **Workspace 360**; (b) **CRUD de planos** + edição de
assinatura/override por tenant + transições de status; (c) **view-as** (greenfield, segurança-crítico);
(d) **playground** (greenfield no front; runtime tem `/run`); (e) tabela de **entitlements efetivos**
(plano + override) e de **sessões de impersonation**.

---

## 3. Princípios de design (inegociáveis)

1. **Tudo passa pelo `requirePlatformAdmin`** e é auditado. A camada plataforma não tem RLS de tenant —
   o guard + audit são a fronteira.
2. **Least privilege por padrão.** View-as começa **read-only**; escrita exige elevação explícita,
   time-boxed e com motivo.
3. **Secrets nunca cruzam a fronteira de visualização.** Nem em view-as, nem no 360 — só metadados.
4. **Sandbox = zero side-effect.** Playground não envia mensagem real, não grava conversão, não consome
   cap de produção (ou consome um cap de teste separado).
5. **Entitlements derivados, não duplicados.** O que um tenant pode usar = `plano.features/limits`
   **merge** `workspace_agent_policies` (override). Uma única função resolve isso; UI e enforcement leem dela.
6. **Reversibilidade.** Toda mutação de admin (mudar plano, override, encerrar trial) é audit-logged com
   before/after e idealmente reversível.

---

## 4. Pilar A — Workspace 360 (hub de tenant)

**Big-tech:** a "customer page" do Stripe / "workspace" do Intercom — uma tela que responde
"quem é esse tenant e está tudo bem?".

**Entrega:** nova seção `Tenants` no painel. Lista paginável/buscável de workspaces (nome, plano,
status, MRR, uso-mês, #membros, saúde) → drill-down **Workspace 360**:

- **Resumo:** plano atual, status (trial/active/…), trial_ends_at, criado em, owner.
- **Uso & custo:** reusa o rollup de `llm_usage_logs` (F25-S05) filtrado por workspace; % do cap.
- **Membros:** lista (role, último acesso) — read-only.
- **Canais:** WhatsApp/Instagram conectados, is_active (metadados, sem tokens).
- **Agentes:** lista de agents + policy efetiva (link p/ Pilar D playground).
- **Saúde:** webhooks com falha, deals/conversas volume, flags de risco (cap estourado, trial vencido).
- **Audit recente** do workspace + **ações de admin** (mudar plano, view-as, suspender).

**Backend:** `GET /platform/workspaces` (lista + filtros + agregados), `GET /platform/workspaces/:id`
(360 agregado — várias queries cross-workspace como owner). **API/UI; sem schema novo.**

---

## 5. Pilar B — Planos & Assinaturas (configurar/personalizar)

**Big-tech:** Stripe Products/Prices + entitlements; overrides por conta (custom deals, grandfathering);
AWS Service Quotas (limites ajustáveis por conta).

### 5.1 Catálogo de Planos (CRUD)
Página `Plans`: CRUD de `plans` (nome, preços mensal/anual, `limits` jsonb, `features` jsonb, posição,
is_active). Editor de `limits`/`features` tipado (não jsonb cru): ex. `limits.max_agents`,
`limits.max_channels`, `limits.max_monthly_messages`, `features.instagram`, `features.flows`,
`features.api_access`. **Define o catálogo comercial.**

### 5.2 Assinatura por tenant (configurar/personalizar)
No Workspace 360 → aba **Assinatura**:
- Atribuir/trocar plano (`workspaces.plan_id` + `subscriptions`).
- Transições de status: trial → active → past_due → canceled/expired, com `trial_ends_at` editável
  (estender trial, conceder cortesia).
- **Override por tenant ("custom plan"):** limites/features específicos que sobrepõem o plano —
  ex. dar +5 agentes a um cliente sem criar plano novo. Hoje `workspace_agent_policies` já é o override
  de IA; para limites NÃO-IA (canais, membros, mensagens) falta um campo de override.
- Billing cycle (monthly/yearly).

### 5.3 Entitlements efetivos (peça central)
Função única `resolveEntitlements(workspaceId)` = `plan.limits/features` **merge** override do workspace.
- IA (allowed_models/caps) → já vem de `workspace_agent_policies` (F25-S03).
- Não-IA (canais/membros/mensagens/features) → **gap**: precisa de `workspace_entitlement_overrides`
  (jsonb `limits`/`features`, nullable, por workspace) OU reusar um campo jsonb em `workspaces`.
- O enforcement do produto (criar canal, convidar membro, etc.) passa a checar `resolveEntitlements`.

### 5.4 Stripe (decisão §9)
Schema Stripe já existe (`stripe_*` em plans/subscriptions). **Duas opções:** (A) manter
`BILLING_ENABLED=false` e gerir assinaturas **internamente** (sem cobrança real) — escopo menor, sem
webhooks Stripe; (B) **ativar Stripe** (checkout, webhooks `customer.subscription.*`, sync de status) —
escopo maior, dinheiro real. **Recomendo (A) primeiro** (gestão interna), Stripe como fase seguinte.

**Schema novo provável:** `workspace_entitlement_overrides` (limites/features não-IA). Migration + RLS
(é workspace-scoped, mas lido pela plataforma) — slot de db dedicado.

---

## 6. Pilar C — View-as / Impersonation (segurança-crítico)

**Big-tech:** Stripe "view as account", Auth0/Intercom impersonation, Zendesk assume identity.
O padrão maduro tem 5 invariantes:

1. **Read-only por padrão.** "View as" mostra o produto pelos olhos do tenant **sem poder escrever**.
   Escrita ("Act as") é um modo separado, com elevação explícita + motivo + menor TTL.
2. **Time-boxed.** Sessão de impersonation expira (ex. 30 min view / 10 min act); renovação explícita.
3. **Banner persistente e inescapável.** "Você está vendo como {workspace} — Sair" em todas as telas.
   Cor distinta. Impossível esquecer que está impersonando.
4. **Auditoria total.** Início/fim, admin, workspace alvo, modo (view/act), motivo, e toda ação de escrita
   feita durante (act) marcada como `acted_by_platform_admin` no audit.
5. **Secrets/PII protegidos.** View-as **não** revela tokens de canal, secrets, nem dados sensíveis além
   do que o próprio cliente veria; campos de billing/Stripe ficam ocultos.

### 6.1 Mecânica técnica
- Nova tabela `impersonation_sessions` (admin_member_id, target_workspace_id, mode `view|act`, reason,
  started_at, expires_at, ended_at, ip). Audit-logged.
- **Token de impersonation escopado:** o admin troca por uma sessão que, no backend, resolve o
  `workspaceId` alvo para o `withWorkspace` — mas com um **flag `impersonation`** que o middleware de
  escrita checa: em modo `view`, qualquer rota não-GET é bloqueada (403); em modo `act`, permitida mas
  audit-marcada. **Nunca** dá acesso a rotas de plataforma nem a secrets.
- Frontend: ao iniciar view-as, o app de workspace `(app)` carrega no contexto do tenant alvo + banner
  global; o cookie/sessão carrega o claim de impersonation (separado da sessão normal).
- **Kill switch:** "Sair" encerra a sessão; expiração automática; admin pode listar/encerrar sessões ativas.

### 6.2 Por que isto é a parte mais delicada
É a única feature que dá a um humano acesso aos dados de produção de um cliente. O design acima (read-only
default, TTL, banner, audit, no-secrets) é o que separa "impersonation de big-tech" de um backdoor. Tem
implicação de **LGPD** (acesso a PII do titular) → o motivo registrado e a auditoria são compliance, não luxo.

**Schema novo:** `impersonation_sessions`. **Middleware novo** na API (resolve impersonation claim → workspace
alvo + modo) sem furar o `requirePlatformAdmin`/sessão normal.

---

## 7. Pilar D — Agent Playground (teste isolado)

**Big-tech:** OpenAI Playground / Anthropic Workbench / Stripe test mode — iterar config sem produção.
**Já é feature do PRD (§80).**

**Entrega:** dado um agente de um tenant (ou um rascunho), rodar uma conversa de teste:
- **Troca de modelo on-the-fly** dentro da `allowed_models` da policy do workspace (respeita whitelist/plano).
- **Override efêmero** de system prompt / temperatura / tools habilitadas — só na sessão de teste.
- **Stream de execução** (reusa SSE do `/run`): mostra tokens, **tool calls + resultados**, custo estimado,
  latência por nó LangGraph (debug real, não caixa-preta).
- **Zero side-effect (invariante):** o runtime roda em **modo sandbox** — `register_conversion`,
  `send_message` (canal real), `trigger_flow` viram **no-op/mock** que apenas registram "teria feito X".
  Sem gravar em `conversations`/`messages` de produção. Custo do teste vai p/ um bucket de teste em
  `llm_usage_logs` (flag `is_test`) ou fora do cap de produção.

### 7.1 Mecânica
- `POST /run` ganha um parâmetro `mode: 'sandbox'` (ou um endpoint `/run/sandbox`) que injeta um
  **tool-executor mock** e desliga persistência. A policy enforcement (caps/whitelist) continua valendo.
- Frontend: página `Playground` no painel (e/ou dentro do Workspace 360 → agente). Chat de teste + painel
  de inspeção (trace) + seletor de modelo/params.
- **Onde mora:** é platform-admin (testar agente de qualquer tenant) **e** faz sentido para o próprio
  cliente no app de workspace (PRD §80 sugere ambos). MVP: platform-admin primeiro.

**Schema:** provavelmente nenhum novo (reusa agents + um flag `is_test` em `llm_usage_logs` — verificar;
se não houver, é uma coluna/coluna-nullable = micro-migration). Runtime: parâmetro sandbox no `/run`.

---

## 8. Decomposição proposta (fase F26)

Espelha o pipeline já validado (guard → APIs backend disjuntas → frontend → runbooks). Encoding de fase
`F26` (= "F2.6", slot.py exige `^F\d+-`). **~11 slots**, schema primeiro onde há gap:

**Onda 0 — schema (sequencial, db):**
- `F26-S01` — schema: `impersonation_sessions` + `workspace_entitlement_overrides` (+ `llm_usage_logs.is_test` se faltar) + migrations + RLS onde workspace-scoped. **db-engineer.**

**Onda 1 — backend (paralelos após S01, sob `routes/platform/`):**
- `F26-S02` — Workspaces API: list + Workspace 360 agregado (`/platform/workspaces`, `/:id`). **backend.**
- `F26-S03` — Plans CRUD API (`/platform/plans`) + editor tipado de limits/features. **backend.**
- `F26-S04` — Subscriptions API por tenant: trocar plano, status, trial, override de entitlements;
  `resolveEntitlements()` central. **backend.**
- `F26-S05` — Impersonation API: criar/encerrar/listar sessão + **middleware de impersonation**
  (read-only/act, TTL, audit). **backend + security-auditor no review.**
- `F26-S06` — Agent sandbox: `mode:'sandbox'` no `/run` (tool-executor mock, no-persist, custo de teste).
  **python-engineer (agent-runtime) + backend (proxy/API).**

**Onda 2 — frontend (após shell F25 + APIs):**
- `F26-S07` — Tenants list + Workspace 360 UI. **frontend.**
- `F26-S08` — Plans catalog + Subscription/entitlements editor UI. **frontend.**
- `F26-S09` — View-as: botão "Ver como", banner global persistente, kill-switch, lista de sessões. **frontend.**
- `F26-S10` — Agent Playground UI (chat de teste + trace + seletor de modelo/params). **frontend.**

**Onda 3 — docs/segurança:**
- `F26-S11` — Runbooks + revisão de segurança: `impersonation-policy.md` (LGPD, TTL, quando usar),
  `manage-tenant-subscription.md`; auditoria `/hm-security` do middleware de impersonation. **security + docs.**

**Grafo:** S01 → {S02,S03,S04,S05,S06 paralelos} → {S07←S02; S08←S03,S04; S09←S05; S10←S06} → S11.
Enforcement de `resolveEntitlements` no produto (checar entitlements ao criar canal/membro) pode ser
follow-up incremental, não bloqueia o painel.

---

## 9. Decisões abertas (precisam do Rogério)

1. **Impersonation — escopo:** só **view-as read-only** (recomendado p/ MVP, risco menor) ou também
   **act-as (escrita)** com elevação? Muda o design de segurança e o tamanho de S05/S09.
2. **Billing — Stripe agora ou depois:** gestão **interna** de assinaturas (sem cobrança real,
   `BILLING_ENABLED=false`) — recomendado primeiro — ou **ativar Stripe** (checkout + webhooks) já nesta fase?
3. **Prioridade dos pilares:** ordem sugerida **A (360) + B (assinaturas) → D (playground) → C (impersonation)**.
   A impersonation é a mais sensível; vale por último (com `/hm-security` dedicado). Concorda ou inverte?
4. **Playground — escopo de acesso:** só platform-admin (MVP) ou também expor ao cliente no app de
   workspace (PRD §80 sugere ambos)?

---

## 10. Riscos & mitigações

| Risco | Mitigação |
|---|---|
| Impersonation vira backdoor | Read-only default, TTL, banner, audit total, no-secrets, motivo obrigatório (LGPD) |
| Playground com side-effect real (manda msg pro cliente!) | Sandbox = tool-executor mock + no-persist; testes E2E que provam zero escrita em produção |
| Entitlements duplicados (plano vs policy divergem) | `resolveEntitlements()` única fonte; UI e enforcement leem dela; nunca hardcode |
| Secrets vazando no 360/view-as | Só metadados; `platform_secrets`/tokens nunca serializados p/ a fronteira de visualização |
| Custo de teste poluindo billing real | `llm_usage_logs.is_test` ou bucket separado; cap de produção intacto |
| Cross-workspace query sem guard | Tudo sob `requirePlatformAdmin`; queries owner explícitas; sem `withWorkspace` de sessão vazando |

---

## 11. Não-objetivos desta fase

- ❌ Cobrança real / dunning / faturas PDF (fase Stripe dedicada, se §9.2 = ativar).
- ❌ Self-service de upgrade pelo cliente (é app de workspace, não platform-admin).
- ❌ Multi-region / read-replica para o 360 (otimização futura se volume exigir).
- ❌ Edição de dados de produção do tenant pelo 360 (isso é o que view-as/act-as cobre, com guardrails).
