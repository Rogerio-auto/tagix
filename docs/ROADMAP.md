# ROADMAP — Execução por fases

> **Documento:** Plano de fases de implementação do v2 após `/hm-init`
> **Versão:** 0.1 — 2026-06-06
> **Estimativa:** 20 semanas / ~5 meses se trabalho focado humano. Com geração IA pesada, pode ser muito menos.

---

## Princípios

1. **Vertical slices, não horizontal layers.** Cada slot entrega uma feature end-to-end (schema + API + UI + teste), não "todos os schemas, depois todas as APIs".
2. **Foundation primeiro.** F0 = nada de produto, tudo de infra. Investimento alto, dividend longo.
3. **Loop rápido cedo.** Login funcional + admin minimal antes do flow builder. Reduz risco percebido.
4. **Cada slot tem definition of done.** Sem isso, slot "vai" infinitamente.
5. **Slots de design system corrida paralela** — mas não interferem em features de produto.
6. **Refator é planejado em slot dedicado**, não em PR de feature.

---

## F0 — Fundação (semanas 1-3)

**Objetivo:** monorepo + CI/CD + DB + auth + workspace + member. Login e admin minimal funcionam.

| Slot | Descrição | DoD |
|---|---|---|
| F0-S01 | Monorepo pnpm + tsconfig base + lint config + packages skeleton | `pnpm install` ok; `pnpm typecheck` ok; package skeletons existem |
| F0-S02 | Docker Compose dev local + Postgres + Redis + RabbitMQ + WAHA | `docker compose up -d` levanta tudo; health checks OK |
| F0-S03 | Drizzle schema básico (workspaces, members, plans, subscriptions, audit_logs) + migrations + seed | `pnpm db:migrate` ok; seed cria 1 workspace + 1 owner |
| F0-S04 | RLS policies em todas as tabelas com `workspace_id` da fase inicial (workspaces, members, plans, subscriptions, audit_logs). **Cada slot de schema NOVO em fases futuras (F1-F8) é obrigado a incluir RLS no mesmo PR** — checklist DoD do slot inclui "RLS policy criada e testada" | Test integration confirma que outro workspace não lê dados |
| F0-S05 | Auth abstraction IAuthProvider + Supabase adapter + login API + JWT cookie | POST /auth/login funciona com Supabase Auth |
| F0-S06 | Express server setup + middlewares (helmet, cors, compression, requireAuth, withRLS) + error handler + **`packages/shared/src/permissions.ts` com matriz `ROLE_CAN` tipada (vide PERMISSIONS.md §3.1) + função `can(role, perm)` usada tanto em backend (requireRole) quanto frontend (esconder UI)** | GET /api/me retorna user + workspace; `can()` é importável em ambos os lados |
| F0-S07 | Socket.io setup + Redis adapter + rooms automáticas | client conecta + recebe `member:online` |
| F0-S08 | Logger Pino + OpenTelemetry SDK + PII masking | logs estruturados em stdout; traces em OTLP coletor |
| F0-S09 | DS v2 base: tokens CSS + Tailwind preset + 5 primitives (Button, Input, Card, Modal, Toast) | Ladle roda; primitives renderizam em dark + light |
| F0-S10 | Frontend skeleton Next.js 15 (App Router): `app/layout.tsx` com providers (TanStack Query, Theme, Toast), `app/(app)/layout.tsx` AppLayout (sidebar + topbar), Zustand stores (auth, theme), middleware Supabase, `next.config.mjs` com `output: 'standalone'`, Dockerfile `web` | `pnpm --filter @hm/web dev` levanta em :3000; rota protegida redireciona pra `/login`; container builda |
| F0-S11 | LoginPage + ResetPasswordPage full DS v2 + RHF + Zod | login funciona end-to-end via UI |
| F0-S12 | CI/CD GitHub Actions: lint + typecheck + build + test + deploy SSH | merge em main → deploy VPS |
| F0-S13 | RabbitMQ topology setup + helper publish/consume + envelope schema | startup setup topology assertions OK |
| F0-S14 | Storage R2 driver + signed URL + local driver dev | upload file, get signed URL, download |

**Entregável F0:** Highermind básico online (login, ver workspace, dark/light, member invite). Sem produto ainda.

---

## F1 — Channels & LiveChat core (semanas 4-7)

**Objetivo:** conectar WhatsApp (Meta + WAHA) com inbox + conversa em tempo real. **Fundamentos Instagram prontos (schema, interface, webhook unificado).**

| Slot | Descrição |
|---|---|
| F1-S01 | Schema channels (provider: `meta_whatsapp` \| `meta_instagram` \| `waha`) + channel_secrets + crypto AES-256-GCM + colunas IG (ig_user_id, fb_page_id, ig_username) |
| F1-S02 | **Webhook Meta unificado** `/webhooks/meta` com signature verify (app_secret platform-level) + despacho por `body.object` + dedup via webhook_events |
| F1-S03 | Schema platform_secrets + carregamento boot-time (meta_app_secret, meta_app_id, meta_webhook_verify_token, encryption keys) |
| F1-S04 | Worker inbound: parser por provider (Meta WA implementado; Meta IG placeholder retorna logged-warn; WAHA implementado) |
| F1-S05 | Schema contacts + conversations (kind: direct/group/story_thread/comment_thread) + messages (type expandido com tipos IG) + Drizzle repos |
| F1-S06 | Schema ig_comments (auxiliar IG, vazio no MVP, populado em F1.5) |
| F1-S07 | Worker outbound: composition parse→dispatch→process→finalize + per-chat lock + provider routing (rejeita `kind` incompatível com `channel.provider`) |
| F1-S08 | MetaWhatsAppAdapter completo: sendText + sendMedia + sendTemplate + sendInteractive |
| F1-S09 | `IChannelAdapter` com union `meta_whatsapp \| meta_instagram \| waha` e capabilities advertise; MetaInstagramAdapter STUB (impl em F1.5) |
| F1-S10 | Worker media: download Meta WA + upload R2 + signed URL |
| F1-S11 | Socket relay: `hm.q.socket.relay` → API consume → io.emit |
| F1-S12 | API GET /conversations + GET /conversations/:id/messages com cache versioning |
| F1-S13 | Frontend ConversationsPage 3 colunas: ChatList + ConversationPanel + ContactInfoPanel skeleton |
| F1-S14 | ChatList real-time com socket events + filters (incluindo filter por **provider**) + search |
| F1-S15 | MessageBubble discriminated union (text/image/video/audio/voice/document/sticker/interactive/template); IG bubbles em stubs (UI placeholder) |
| F1-S16 | MessageComposer + media upload + emoji + mention `@` |
| F1-S17 | 24h Meta window lock no composer + CTA template (WA); composer state machine pronta para IG (banner Human Agent Tag) |
| F1-S18 | WAHA adapter (inbound + outbound) + session management |
| F1-S19 | Channel settings page: connect Meta (UI wizard FB Login) + WAHA; passos IG-específicos do wizard stubados |
| F1-S20 | Read receipts e delivery status (status callbacks Meta WA) |
| F1-S21 | Typing/recording presence (pre_action) |
| F1-S22 | Mentions em notas internas (`conversation_notes` + auto-notification) |
| F1-S23 | Auto-assign + manual transfer + routing_history |

**Entregável F1:** Inbox WhatsApp funcional. Atender conversas via UI Highermind. Schema/interface Instagram preparados para F1.5. Sem IA ainda.

---

## F1.5 — Instagram channel completion (semanas 8-9, pós-MVP estrito)

**Objetivo:** sair de "schema-ready" para Instagram funcionando ponta a ponta, antes do disparo comercial pleno.

| Slot | Descrição |
|---|---|
| F1.5-S01 | App Review Meta (`instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `pages_messaging`); runbook `meta-app-review-instagram.md` |
| F1.5-S02 | `MetaInstagramAdapter` completo: webhook parser (DMs + postbacks + reactions + reads + referrals) |
| F1.5-S03 | Story mentions: parser + ensure conversation kind='direct' + fila prioritária media-download (URL expirável) |
| F1.5-S04 | Story replies: parser + persist com `metadata.story_id` |
| F1.5-S05 | Shares: parser + persist preview do post/reel |
| F1.5-S06 | Comments webhook parser (`entry.changes[].field='comments'`) + ensure ig_comments row + conversation kind='comment_thread' (uma por media_id × contact) |
| F1.5-S07 | Send DM IG (sendText + sendMedia com attachment URL pública) |
| F1.5-S08 | Send Interactive IG: quick_replies + generic_template + button_template (schemas Zod estendidos em `packages/shared`) |
| F1.5-S09 | Message tags IG: `HUMAN_AGENT` aplicado automaticamente quando composer state == 'human_agent_tag'; audit log obrigatório |
| F1.5-S10 | Comments actions: replyPublicToComment + sendPrivateReplyToComment (comment-to-DM) + hideComment + deleteComment |
| F1.5-S11 | Frontend MessageBubble IG: StoryMention, StoryReply, Share, Comment, QuickReplies, GenericTemplate, Referral |
| F1.5-S12 | Frontend ComposerInstagram (toggle "Responder publicamente / por DM" em comment_thread) |
| F1.5-S13 | Channel connect wizard step IG completo (FB Login + seleção Page + IG Business Account + webhook subscription) |
| F1.5-S14 | Tools agente IG-específicas: `reply_to_comment`, `private_reply_to_comment`, `hide_comment` (requires_human_approval default ON), `delete_comment` (requires_human_approval sempre) |
| F1.5-S15 | Campaigns: validation IG-specific (no template_name; recipients sem interação prévia bloqueados; message_tag obrigatório fora janela 24h); UI wizard tabs por provider |
| F1.5-S16 | Métricas OTel IG (`hm.ig.messages.received{type}`, `hm.ig.comments.actions{action}`, `hm.ig.outbound.message_tag_used{tag}`) |
| F1.5-S17 | e2e Playwright cenário Instagram (mock webhook IG → DM → story mention → comment → private reply) |

**Entregável F1.5:** Highermind atende Instagram como canal de primeira classe — DMs + stories + comments com private reply.

---

## F2 — Agent runtime Python + Agentes IA (LangGraph Python + OpenRouter) (semanas 10-13)

**Objetivo:** microsserviço Python de agentes em produção, agentes IA respondendo via OpenRouter com tool calling e controle super-admin.

| Slot | Descrição |
|---|---|
| F2-S01 | Schema agents + agent_templates + agent_template_questions + tools + agent_tools + tool_logs + agent_executions + llm_usage_logs + llm_models_whitelist + workspace_agent_policies |
| F2-S02 | Container `agent-runtime` (Python 3.13 + FastAPI + LangGraph + LangServe + httpx + asyncpg) com Dockerfile + healthcheck + Pino-equivalent (loguru com PII redact) |
| F2-S03 | Pacote `packages/agents-client/` (Node) — cliente HTTP tipado para chamar agent-runtime (request schema Zod compartilhado via OpenAPI export do Python) |
| F2-S04 | OpenRouterProvider em Python (chat completion HTTP + streaming + tool calls + captura `openrouter_generation_id` e `upstream_provider`) |
| F2-S05 | Build do graph LangGraph (load_context → build_prompt → call_model → tool_dispatch → finalize) com PostgresSaver (PostgresCheckpointer schema gerado) |
| F2-S06 | Tool registry Python: tools "leves" (query_contact, query_conversation, search_knowledge_base) via asyncpg + workspace context RLS |
| F2-S07 | Tools "de negócio" via callback HTTP para Node (`POST api:3001/internal/tools/{toolKey}` com token compartilhado): transfer_to_human, mark_resolved, trigger_flow, schedule_event, move_deal_stage, change_conversation_status |
| F2-S08 | Policy enforcement: agent-runtime aplica `policy_snapshot` recebido na request (filtra tools, valida modelo, ajusta max_iterations, bloqueia se modelo fora da whitelist) |
| F2-S09 | Hard cap enforcement no Node antes da chamada: `policy.max_monthly_cost_usd - sum(llm_usage_logs) > custo_estimado`; bloqueia se excede |
| F2-S10 | Column-level access control para tools tipo database (Python) |
| F2-S11 | Worker integration: ai_mode='on' + nova mensagem inbound → `agentsClient.run({...})` retorna AsyncGenerator de eventos |
| F2-S12 | Aggregation buffer (window_sec) no Node antes de chamar runtime |
| F2-S13 | Cost tracking + agent_metrics aggregation a partir de `llm_usage_logs` |
| F2-S14 | Seed: 5 agent templates globais (sales, reception, support, first_touch, follow_up) + questions + default_tools + default_model (`openai/gpt-4o-mini`) |
| F2-S15 | Seed: catálogo inicial `llm_models_whitelist` (top 15 modelos OpenRouter de uso real) |
| F2-S16 | API CRUD agents + tools_global + agent_tools toggle (Node) |
| F2-S17 | Frontend AgentsListPage + AgentCreationWizard (RHF + template + questions + model picker filtrado por policy do workspace) |
| F2-S18 | Frontend AgentDetailPage com tabs (Config, Tools, Knowledge, Metrics, Playground) |
| F2-S19 | Playground com SSE streaming (proxy via API Node) |
| F2-S20 | Tools modulares por categoria: workflow tools (transfer_to_human, escalate, mark_resolved, change_conversation_status) + **`register_conversion` (categoria workflow; respeita `workspace_agent_policies.allow_agent_conversions` + `agent_conversion_require_approval`; integra com schema de F5-S13)** |
| F2-S21 | Auto follow-up cron job idempotente |

**Entregável F2:** Agente IA responde clientes via WhatsApp (e via Instagram após F1.5) com tool calling, modelos via OpenRouter, transferindo para humano quando preciso.

---

## F2.5 — Super-admin de IA (semana 14)

**Objetivo:** painel de plataforma para gerenciar IA cliente a cliente.

| Slot | Descrição |
|---|---|
| F2.5-S01 | Painel `apps/web/src/features/platform-admin/` (proteção `is_platform_admin=true` em todas as rotas) |
| F2.5-S02 | LlmModelsCatalogPage: lista `llm_models_whitelist`, ativa/desativa, sync com OpenRouter `/api/v1/models` |
| F2.5-S03 | WorkspaceAgentPoliciesPage: editor por workspace (allowed_models, features LangGraph, caps) |
| F2.5-S04 | PlatformSecretsPage: rotação de OpenRouter API key + Meta App Secret + encryption keys (com auditoria) |
| F2.5-S05 | LlmUsageDashboard: roll-up de `llm_usage_logs` (gasto por workspace, modelo, dia/mês; top spenders; alertas de cap próximo) |
| F2.5-S06 | Runbook `rotate-openrouter-key.md` + `manage-workspace-agent-policy.md` |

**Entregável F2.5:** Rogério (super-admin) define what each workspace can use no painel sem mexer em código.

---

## F3 — Knowledge Base + RAG (semana 11)

**Objetivo:** RAG funcional para agentes consultarem base de conhecimento.

| Slot | Descrição |
|---|---|
| F3-S01 | Schema kb_documents + kb_chunks (pgvector HNSW index) + kb_feedback |
| F3-S02 | Ingest pipeline: upload markdown → semantic chunking → embedding text-embedding-3-small → persist |
| F3-S03 | Tool `search_knowledge_base` com vector search + ranking por priority/usage |
| F3-S04 | Frontend KnowledgeBasePage: upload, list, edit, preview chunks |
| F3-S05 | Feedback loop: agente cita doc → user marca útil/não útil |

**Entregável F3:** Agente IA consulta KB para responder perguntas sobre produto/serviço.

---

## F4 — Flow Builder (semanas 12-14)

**Objetivo:** automação visual de fluxos.

| Slot | Descrição |
|---|---|
| F4-S01 | Schema flows + flow_versions + flow_executions + flow_logs + flow_submissions |
| F4-S02 | Pacote @hm/flow-engine: types + registry + dispatcher |
| F4-S03 | Worker-flows: processFlowStep + queue management |
| F4-S04 | Scheduler: flow wakeup 1min (WAITING + next_step_at <= now) |
| F4-S05 | Handlers: trigger + message + interactive |
| F4-S06 | Handlers: wait + wait_for_response (biestável) + condition + switch |
| F4-S07 | Handlers: add_tag + remove_tag + change_status + ai_action |
| F4-S08 | Handlers: http_request + external_notify + meta_flow |
| F4-S09 | API CRUD flows + publish (cria version) + trigger manual + list executions + cancel |
| F4-S10 | Frontend FlowsListPage + manual flows drag-reorder |
| F4-S11 | Frontend FlowEditorPage: canvas ReactFlow + NodePalette + Inspector |
| F4-S12 | Frontend nodes modulares (1 pasta por tipo, 14 tipos) + metadata + Inspector custom |
| F4-S13 | Validation Zod no save + cycle detection + unreachable nodes + variable refs |
| F4-S14 | Manual flows quickbar no LiveChat (FX-029d port) |
| F4-S15 | FlowExecutionsBadge em ChatHeader + ChatList (FX-031c/d port) |
| F4-S16 | Confirm modal manual trigger (FX-031a port) |
| F4-S17 | Trigger dispatcher: NEW_MESSAGE (keyword/type), STAGE_CHANGE, TAG_ADDED, NEW_LEAD |
| F4-S18 | Meta flow_submission webhook + trigger flow |

**Entregável F4:** Flow builder visual funcional. Triggers automáticos. Manual flows no chat.

---

## F5 — Pipeline (semanas 15-16)

**Objetivo:** funil de vendas/atendimento integrado.

| Slot | Descrição |
|---|---|
| F5-S01 | Schema pipelines + stages + deals + deal_history + deal_attachments (**sem deal_tasks**; decisão PRD §3.3 #1) |
| F5-S02 | API CRUD pipelines + stages + deals + move_stage com validation/automation/history |
| F5-S03 | Frontend PipelinePage: kanban horizontal com dnd-kit + filters |
| F5-S04 | Frontend DealCard + DealDetailDrawer (tabs: overview, attachments, history) |
| F5-S05 | Custom fields settings + UI editor + dynamic form rendering |
| F5-S06 | Stage transition rules: required_fields + required_roles |
| F5-S07 | Stage automation rules engine + pending_automations table + worker |
| F5-S08 | Deal attachments: CardImageCapture com GPS/EXIF + R2 upload + gallery |
| F5-S09 | Tool agente `move_deal_stage` + `query_deal` |
| F5-S10 | Real-time sync deal:* events via Socket.IO |
| F5-S11 | **Seed nicho:** pipeline templates por vertical (imobiliária + clínica no MVP; demais vertentes pós-MVP) + onboarding wizard "criar workspace a partir de nicho" |
| F5-S12 | **Seed nicho:** variantes de `agent_templates` por nicho (sales_real_estate, support_clinic, etc.) com prompts polidos pelos 2 nichos prioritários |
| F5-S13 | **Sistema de conversões — schema + API:** migration `conversion_types` + `conversion_events` + `conversion_tag_triggers` + RLS + API CRUD types + endpoint `POST /api/conversions` (manual) + endpoint `GET /api/conversions` (lista filtrada) + endpoint `POST /api/conversions/:id/cancel` + dedup UNIQUE same-day enforced |
| F5-S14 | **Sistema de conversões — UI:** botão "Marcar conversão" no header de conversa + DealDetailDrawer + contato; modal de marcação (tipo + valor + nota + atribuição sugerida); página `/conversions` com filtros; settings `/settings/conversions` para CRUD de `conversion_types` + gatilhos por stage/tag |
| F5-S15 | **Sistema de conversões — automações:** stage automation rule `register_conversion` + tag trigger via Postgres trigger em `contact_tags`; integração com flow-engine handler `register_conversion` |

**Entregável F5:** Pipeline funcional, deals movem entre stages com automação, integração com agente IA, **dois nichos canônicos (imobiliária + clínica) com pipeline e agentes prontos out-of-the-box**.

---

## F6 — Campanhas (semana 17)

**Objetivo:** disparos massivos compliance Meta + LGPD.

| Slot | Descrição |
|---|---|
| F6-S01 | Schema campaigns + campaign_steps + campaign_recipients + campaign_deliveries (idempotency) + campaign_metrics + campaign_followups |
| F6-S02 | Worker-campaigns: tick 1min + send window + rate adaptive + dispatch delivery |
| F6-S03 | Followup processor com pending_followups persistente (não setTimeout) |
| F6-S04 | API validate + activate + pause + recipients bulk upload + bulk opt-in |
| F6-S05 | Opt-in/opt-out: registro manual + auto via keywords (STOP/PARAR/SAIR/CANCELAR) |
| F6-S06 | Meta error codes handling (130472/131026/131047/131051) + auto-pause se RED |
| F6-S07 | Frontend CampaignEditor wizard 6 steps + template picker + recipients import CSV + send_windows editor |
| F6-S08 | Frontend CampaignsPage + monitoring real-time + health badge |
| F6-S09 | AI handoff on reply integration |

**Entregável F6:** Disparos compliance funcionais com métricas em tempo real.

---

## F7 — Calendar (semana 18)

**Objetivo:** agendamento + agente IA marcando reuniões.

| Slot | Descrição |
|---|---|
| F7-S01 | Schema calendars + availability_rules + availability_exceptions + events + event_participants |
| F7-S02 | Função `compute_available_slots` PL/pgSQL (com buffer) |
| F7-S03 | API CRUD calendars + events + availability + slots endpoint |
| F7-S04 | Calendar tools agente: list_calendars + get_available_slots + schedule_event |
| F7-S05 | Frontend CalendarPage com FullCalendar + view month/week/day |
| F7-S06 | Frontend EventForm + AvailabilityRulesPage |
| F7-S07 | Event reminders cron + notifications + outbound WhatsApp opcional |

**Entregável F7:** Agente IA marca reunião via WhatsApp; member vê na agenda.

---

## F8 — Dashboards, Settings panel & Admin (semanas 19-20)

**Objetivo:** dashboard role-aware (5 dashboards), painel de settings com 22 seções organizadas em 3 níveis, painéis admin (workspace + platform).

| Slot | Descrição |
|---|---|
| F8-S01 | **Dashboard backend:** API `GET /api/dashboard/me` retorna estrutura `{ role, cards[], alerts[], layout_preferences }` filtrada server-side por role (vide DASHBOARD.md §8). Materialized views `mv_dashboard_*` + jobs scheduler de refresh (5min/1h/1d) |
| F8-S02 | **Dashboard role-aware — AGENT + READONLY:** cards "minhas conversas", "fila", "IA rodando", próximas ações, resolvidas hoje, conversões pessoais (se workspace tem `conversion_types`). Drill-down via drawer (UX_PRINCIPLES §2.3) |
| F8-S03 | **Dashboard role-aware — SUPERVISOR:** equipe overview, alertas SLA, performance por atendente (tabela ordenável), conversões da equipe + ranking, charts canal/campanha |
| F8-S04 | **Dashboard role-aware — ADMIN:** saúde do workspace, atenção (tokens expirando, cap IA, quality rating), tendências 30d, canais conectados, deps/times |
| F8-S05 | **Dashboard role-aware — OWNER:** camada financeira (convertido mês, taxa conversão, ticket médio, ROI/CAC aprox), funil + conversões marcadas, custos operacionais |
| F8-S06 | **Dashboard real-time:** socket events `dashboard:metric_changed` filtrados por role; client component com TanStack Query + refetchInterval 5min |
| F8-S07 | **Dashboard customização pessoal:** `members.dashboard_layout` editor (hide/show/reorder cards, default_period); enforcement de cards obrigatórios definidos pelo ADMIN em `/settings/dashboard` |
| F8-S08 | **Settings panel — estrutura:** layout 3-níveis (Pessoal/Workspace/Plataforma) com sidebar agrupada + busca Cmd+K + contadores/alertas por seção (vide PERMISSIONS.md §5) |
| F8-S09 | **Settings Pessoal:** Perfil, Preferências (theme/density/locale), Dashboard layout editor, Notificações (toggles globais on/off MVP), Sons, Atalhos referência, Sessões, Senha, Conta |
| F8-S10 | **Settings Workspace — operação:** Workspace info, Marca leve, Canais (já tem em F1-S19, integra aqui), Membros (invite/role-change), Departamentos, Times, Auto-assign, Horário comercial, SLAs, Tags, Custom fields |
| F8-S11 | **Settings Workspace — IA + conversões:** seção Agentes IA (já tem em F2, integra), Knowledge Base, Pipelines, **Conversões (CRUD `conversion_types` + gatilhos)** |
| F8-S12 | **Settings Workspace — segurança/compliance:** API keys, Webhooks outbound, Privacidade/LGPD, Compliance Meta, Audit log viewer |
| F8-S13 | **Settings Plataforma (super-admin):** integra com F2.5 (já criada). Adiciona Modo manutenção + banners globais + notificações forçadas |
| F8-S14 | Admin WorkspacesPage + detail tabs (overview, channels, agents, members, usage de IA via llm_usage_logs, billing, logs, subscription, conversões agregadas) |
| F8-S15 | Admin InfrastructurePage com 6 tabs (Postgres, Redis, RabbitMQ, Workers, agent-runtime, Overview) |
| F8-S16 | Admin TemplatesPage (agent_templates global): list, editor, tester |
| F8-S17 | Admin ToolsPage: monitoring + add custom |
| F8-S18 | Audit logs viewer cross-workspace (platform_admin) + per-workspace (ADMIN) com filtros |

**Entregável F8:** 5 dashboards distintos + settings panel completo organizado em 3 níveis + admin platform completo.

---

## F9 — API pública + Webhooks outbound (semana 20)

**Objetivo:** API v1 para integrações externas + webhooks pra cliente.

| Slot | Descrição |
|---|---|
| F9-S01 | API key auth + rate limit by key |
| F9-S02 | Endpoints /api/v1: send_message + send_template + upsert_contact + trigger_flow + list_conversations + get_conversation |
| F9-S03 | OpenAPI spec gen do Zod schemas + Swagger UI |
| F9-S04 | Outbound webhooks: schema + subscription UI + HMAC signature |
| F9-S05 | Worker-webhooks: dispatch + retry with exponential backoff |
| F9-S06 | Frontend Settings → Dev page (API keys + webhooks) |

**Entregável F9:** API pronta para integradores externos. Webhooks confiáveis.

---

## F10 — Polish + observability + e2e (semana 21+)

**Objetivo:** smoothing, métricas, prontidão pra clientes.

| Slot | Descrição |
|---|---|
| F10-S01 | Setup Grafana + Prometheus / OTLP coletor; dashboards essenciais |
| F10-S02 | Sentry integration opcional |
| F10-S03 | e2e Playwright completo (login → connect channel → send msg → agent reply → flow trigger → deal move) |
| F10-S04 | Painéis de ajuda contextual `(?)` em todas as features |
| F10-S05 | LGPD endpoints: export + delete (direito ao esquecimento) |
| F10-S06 | Performance audit + bundle size optimization + Lighthouse score |
| F10-S07 | Accessibility audit + a11y fixes + AAA contraste validation |
| F10-S08 | Security audit (OWASP top 10) + pen-test scan |
| F10-S09 | Runbooks: incident-postgres-down, restore-from-backup, rotate-encryption-key, meta-waba-banned |
| F10-S10 | Documentação API completa (Mintlify/Docusaurus) |

---

## Fases 2+ (pós-MVP)

Fora do MVP estrito, vide PRD §3.2:

- Landing page e Cadastro multi-step
- Stripe billing ativado + plan upgrade flow
- Google Calendar / Outlook sync
- Mobile PWA
- Mais providers (**Telegram, Email** — Instagram já está em F1.5)
- Human-in-the-loop interrupts em agentes: UI de aprovação completa (schema-ready desde MVP via `workspace_agent_policies.allow_interrupts`)
- A/B testing de campanhas
- Auto-moderação ML de comments IG (`moderate_comment` tool)
- Custom tools criadas via UI declarativa (JSON schema)
- Multi-region deploy
- Read replicas Postgres
- Documents/templates DOCX (se vertical pedir)
- Instagram Threads (app separado da Meta)

---

## Métricas de progresso

Por slot:
- **DoD documentada** (checklist mergeável)
- **Coverage do código novo** ≥ 70%
- **Time-to-merge** (PR aberto → merged): < 2 dias média

Por fase:
- **Burndown chart** semanal (slots restantes)
- **Demo interna** ao fim de cada fase para Rogério (e/ou eventual time)

---

## Riscos top 5 do roadmap

| Risco | Mitigation |
|---|---|
| LangGraph.js maturidade Node | Fallback: runtime custom inspirado em LangGraph se ecossistema falhar. Mas começa com LangGraph |
| Meta política mudar (24h window, opt-in stricto) | Adapter isolado; auditar Meta docs trimestral; runbook de resposta a ban |
| Performance Postgres com escala | Pesar leituras com cache; criar índices proactivos; monitorar slow queries desde dia 1 |
| Time único (Rogério) com escopo grande | Priorizar MVP estrito; cortar feature em vez de cortar qualidade |
| Pinch de carga (Meta high volume burst) | Rate limit adaptativo + DLQ inspecionável + scale workers (replicas) |

---

## Cronograma alto nível

```
Semana         1   2   3   4   5   6   7   8   9   10  11  12  13  14  15  16  17  18  19  20  21  22  23  24
F0 Fund.       X   X   X
F1 Chat                    X   X   X   X
F1.5 IG full                               X   X
F2 Agents                                          X   X   X   X
F2.5 Admin IA                                                       X
F3 KB                                                                   X
F4 Flow                                                                    X   X   X
F5 Pipeline                                                                              X   X
F6 Camp.                                                                                         X
F7 Cal.                                                                                              X
F8 Dash                                                                                                  X
F9 API                                                                                                       X
F10 Polish                                                                                                       X
```

(23-24 semanas em ritmo focado humano. Com IA gerando código pesado: 10-14 semanas plausíveis.)

F1.5 vem antes de F2 propositadamente: a inbox precisa estar 100% multi-canal antes de plugar agentes IA — agentes que respondem em só um canal ficam disfuncionais em workspaces que conectarem Instagram.

---

## Definition of done per slot (template)

- [ ] Schema migration applied + tested em integration
- [ ] API endpoint implementado + integration test passa
- [ ] Frontend component implementado + Ladle story se for primitive DS v2
- [ ] Unit tests para lógica de service/lib
- [ ] Zod schemas em `packages/shared` para qualquer payload novo
- [ ] Log estruturado em pontos críticos
- [ ] DS v2 tokens used (sem hardcoded)
- [ ] Estados implementados (default/hover/focus/loading/error)
- [ ] ARIA roles em componentes interativos
- [ ] `(?)` painel de ajuda para feature visível
- [ ] PR description tem screenshot/GIF + checklist DoD marcado
- [ ] CI verde (lint + typecheck + build + test)
- [ ] Review aprovado

---

> Roadmap muda conforme aprendemos. Toda mudança aprovada gera versão do doc.
