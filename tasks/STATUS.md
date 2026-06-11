# STATUS — Board de slots

> Atualize via `python scripts/slot.py sync` (NAO edite a mao — slot frontmatters sao a fonte da verdade).

Legenda: `available` 🟢 · `blocked` ⏸️ · `claimed` 🟡 · `in-progress` 🔵 · `review` 🟣 · `done` ✅ · `cancelled` ⚫

## Resumo

| Fase | Total | 🟢  | ⏸️  | 🟡  | 🔵  | 🟣  | ✅  |
| ---- | ----- | --- | --- | --- | --- | --- | --- |
| F0   | 16     | 0   | 0   | 0   | 0   | 0   | 16   |
| F1   | 26     | 0   | 0   | 0   | 0   | 0   | 26   |
| F2   | 21     | 0   | 0   | 0   | 0   | 0   | 21   |
| F3   | 7     | 0   | 0   | 0   | 0   | 0   | 7   |
| F4   | 14     | 0   | 0   | 0   | 0   | 0   | 14   |
| F5   | 16     | 0   | 0   | 0   | 0   | 0   | 16   |
| F6   | 9     | 0   | 0   | 0   | 0   | 0   | 9   |
| F7   | 7     | 0   | 0   | 0   | 0   | 0   | 7   |
| F8   | 10     | 0   | 0   | 0   | 0   | 0   | 10   |
| F9   | 6     | 0   | 2   | 0   | 0   | 1   | 3   |

## Fase 0 — Fundação

| ID     | Titulo                                                                                          | Status | Prioridade | Depende de     |
| ------ | ----------------------------------------------------------------------------------------------- | ------ | ---------- | -------------- |
| F0-S01 | Monorepo pnpm + tsconfig base + lint + skeletons de packages/apps                               | ✅ done | high       | —              |
| F0-S02 | Docker Compose dev — Postgres pgvector + Redis + RabbitMQ + WAHA                                | ✅ done | high       | F0-S01         |
| F0-S03 | Schema Drizzle base + migrations + seed (workspaces, members, plans, subscriptions, audit_logs) | ✅ done | critical   | F0-S01         |
| F0-S04 | RLS policies multi-tenant + teste de isolamento                                                 | ✅ done | critical   | F0-S03         |
| F0-S05 | Auth — IAuthProvider + Supabase adapter + login/logout API + cookie de sessão                   | ✅ done | critical   | F0-S03         |
| F0-S06 | Express 5 server + middlewares + matriz de permissões can() em @hm/shared                       | ✅ done | critical   | F0-S03, F0-S05 |
| F0-S07 | Socket.io + Redis adapter + rooms por workspace/member                                          | ✅ done | high       | F0-S06         |
| F0-S08 | Logger Pino + OpenTelemetry + PII masking em @hm/logger                                         | ✅ done | high       | F0-S01         |
| F0-S09 | Design tokens — CSS vars + Tailwind preset + tipografia + fontes                                | ✅ done | critical   | F0-S01         |
| F0-S10 | "@hm/ui base — infra + Ladle + 5 primitives (Button, Input, Card, Modal, Toast)"                | ✅ done | critical   | F0-S09         |
| F0-S11 | apps/web shell — Next 15 App Router + providers + theme-no-flash + AppLayout                    | ✅ done | high       | F0-S10         |
| F0-S12 | Infra de UX — EmptyState, ErrorState, HelpPanel, CommandPalette, atalhos, density               | ✅ done | high       | F0-S11         |
| F0-S13 | Login + ResetPassword (DS v2, RHF + Zod) — primeira tela ponta-a-ponta                          | ✅ done | high       | F0-S11, F0-S12 |
| F0-S14 | RabbitMQ topology + helper publish/consume + envelope schema                                    | ✅ done | high       | F0-S08         |
| F0-S15 | Storage — LocalDriver (dev) + R2Driver (S3) + signed URL                                        | ✅ done | medium     | F0-S01         |
| F0-S16 | CI GitHub Actions — lint + typecheck + build + test (+ deploy SSH inerte)                       | ✅ done | medium     | F0-S01         |

## Fase 1 — Channels & LiveChat core

| ID     | Titulo                                                                        | Status | Prioridade | Depende de                             |
| ------ | ----------------------------------------------------------------------------- | ------ | ---------- | -------------------------------------- |
| F1-S01 | Schema channels + channel_secrets + crypto AES-256-GCM (+ colunas IG)         | ✅ done | critical   | F0-S03, F0-S04                         |
| F1-S02 | Webhook Meta unificado + signature verify + dedup (webhook_events)            | ✅ done | critical   | F0-S06, F1-S01                         |
| F1-S03 | Schema platform_secrets + carregamento boot-time                              | ✅ done | high       | F0-S03                                 |
| F1-S04 | Worker inbound — parser por provider + persist + relay                        | ✅ done | critical   | F1-S02, F1-S05, F1-S09                 |
| F1-S05 | Schema contacts + conversations + messages + repos + interactive types        | ✅ done | critical   | F1-S01                                 |
| F1-S06 | Schema ig_comments (auxiliar Instagram)                                       | ✅ done | low        | F1-S05                                 |
| F1-S07 | Worker outbound — composition + per-chat lock + provider routing              | ✅ done | critical   | F1-S05, F1-S08, F1-S09                 |
| F1-S08 | MetaWhatsAppAdapter completo (sendText/Media/Template/Interactive + parser)   | ✅ done | critical   | F1-S09                                 |
| F1-S09 | IChannelAdapter + capabilities + graphClient + MetaInstagramAdapter STUB      | ✅ done | critical   | F1-S01                                 |
| F1-S10 | Worker media — download Meta + dedup SHA-256 + upload R2 + signed URL         | ✅ done | high       | F1-S04, F1-S08, F0-S15                 |
| F1-S11 | Socket relay — hm.q.socket.relay → io.emit + socket-events tipados            | ✅ done | high       | F0-S07, F1-S05                         |
| F1-S12 | API GET /conversations + /conversations/:id/messages + cache versioning       | ✅ done | critical   | F1-S05, F0-S06                         |
| F1-S13 | Frontend ConversationsPage — layout 3 colunas + ContactInfoPanel skeleton     | ✅ done | high       | F0-S11, F0-S12, F1-S12                 |
| F1-S14 | ChatList — real-time + filtros (incl. provider) + search + scroll infinito    | ✅ done | high       | F1-S13, F1-S11, F1-S12                 |
| F1-S15 | MessageBubble — discriminated union (text/image/.../interactive); IG em stubs | ✅ done | high       | F1-S13, F1-S05, F1-S10                 |
| F1-S16 | MessageComposer — textarea + media upload + emoji + mention @ + reply         | ✅ done | high       | F1-S13, F1-S12                         |
| F1-S17 | Janela 24h Meta no composer + CTA template (WA) + state machine IG-ready      | ✅ done | high       | F1-S16, F1-S07                         |
| F1-S18 | WAHAAdapter (inbound + outbound) + session management                         | ✅ done | high       | F1-S09                                 |
| F1-S19 | Channel settings page + connect wizard (Meta FB Login + WAHA)                 | ✅ done | high       | F1-S01, F1-S03, F0-S11                 |
| F1-S20 | Read receipts e delivery status (status callbacks Meta WA)                    | ✅ done | medium     | F1-S07, F1-S11, F1-S15                 |
| F1-S21 | Typing/recording presence (pre_action)                                        | ✅ done | low        | F1-S07, F1-S11                         |
| F1-S22 | Notas internas com mentions (conversation_notes + auto-notification)          | ✅ done | medium     | F1-S05, F1-S12                         |
| F1-S23 | Auto-assign + manual transfer + routing_history                               | ✅ done | medium     | F1-S05, F1-S12                         |
| F1-S24 | API send message — POST /api/conversations/:id/messages → enqueue outbound    | ✅ done | critical   | F1-S05, F1-S07, F1-S12                 |
| F1-S25 | Web socket client — SocketProvider + window.__hmSocket (liga o realtime)      | ✅ done | critical   | F1-S11, F0-S11                         |
| F1-S26 | Worker bootstrap + persistência direta (@hm/db) + adapter factory             | ✅ done | critical   | F1-S04, F1-S07, F1-S10, F1-S20, F1-S21 |

## Fase 2 — Agent runtime + Agentes IA

| ID     | Titulo                                                                                       | Status | Prioridade | Depende de             |
| ------ | -------------------------------------------------------------------------------------------- | ------ | ---------- | ---------------------- |
| F2-S01 | Schema de agentes IA (agents, templates, tools, executions, llm usage, policies)             | ✅ done | critical   | —                      |
| F2-S02 | Container agent-runtime (FastAPI + LangGraph + LangServe + asyncpg) + logging                | ✅ done | critical   | —                      |
| F2-S03 | Pacote @hm/agents-client (cliente Node tipado p/ agent-runtime)                              | ✅ done | critical   | F2-S02                 |
| F2-S04 | OpenRouterProvider (chat completion + streaming + tool calls + usage capture)                | ✅ done | critical   | F2-S02                 |
| F2-S05 | Grafo LangGraph (load_context → build_prompt → call_model → tools → finalize) + checkpointer | ✅ done | critical   | F2-S02, F2-S04, F2-S01 |
| F2-S06 | Tool registry + tools "leves" (query_contact/conversation/search_kb) via asyncpg RLS         | ✅ done | high       | F2-S02, F2-S01, F2-S10 |
| F2-S07 | Tools de negócio via callback HTTP para o Node (internal tools endpoint)                     | ✅ done | high       | F2-S06, F2-S01         |
| F2-S08 | Policy enforcement no runtime (filtra tools, valida modelo, max_iterations)                  | ✅ done | high       | F2-S05, F2-S01         |
| F2-S09 | Hard cap de custo no Node antes da chamada ao runtime                                        | ✅ done | high       | F2-S01, F2-S03         |
| F2-S10 | Column-level access control para tools de database                                           | ✅ done | medium     | F2-S02                 |
| F2-S11 | Worker de agentes — ai_mode='on' + inbound → agentsClient.run (stream)                       | ✅ done | critical   | F2-S03, F2-S05, F2-S09 |
| F2-S12 | Aggregation buffer (window_sec) antes de chamar o runtime                                    | ✅ done | medium     | F2-S11                 |
| F2-S13 | Cost tracking + agregação de agent_metrics a partir de llm_usage_logs                        | ✅ done | medium     | F2-S01                 |
| F2-S14 | Seed — 5 agent templates globais + questions + default_tools + default_model                 | ✅ done | medium     | F2-S01                 |
| F2-S15 | Seed — catálogo inicial llm_models_whitelist (top modelos OpenRouter)                        | ✅ done | medium     | F2-S01                 |
| F2-S16 | API CRUD agents + tools_global + toggle agent_tools (Node)                                   | ✅ done | high       | F2-S01, F2-S03         |
| F2-S17 | Frontend AgentsListPage + AgentCreationWizard                                                | ✅ done | high       | F2-S16, F2-S14, F2-S15 |
| F2-S18 | Frontend AgentDetailPage com tabs (Config, Tools, Knowledge, Metrics, Playground)            | ✅ done | medium     | F2-S16, F2-S17         |
| F2-S19 | Playground do agente com SSE streaming (proxy via API Node)                                  | ✅ done | medium     | F2-S16, F2-S05, F2-S18 |
| F2-S20 | Tools workflow modulares + register_conversion (respeitando policies)                        | ✅ done | medium     | F2-S07, F2-S06         |
| F2-S21 | Auto follow-up cron job idempotente                                                          | ✅ done | low        | F2-S11                 |

## Fase 3 — Flow Builder

| ID     | Titulo                                                                            | Status | Prioridade | Depende de             |
| ------ | --------------------------------------------------------------------------------- | ------ | ---------- | ---------------------- |
| F3-S01 | Schema Knowledge Base (kb_documents, kb_chunks pgvector, kb_feedback) + RLS       | ✅ done | critical   | —                      |
| F3-S02 | Embeddings provider (OpenAI direto) + endpoint interno /embed + usage logging     | ✅ done | critical   | —                      |
| F3-S03 | Ingest pipeline (worker) — chunking + embeddings + persist kb_chunks              | ✅ done | high       | F3-S01, F3-S02, F3-S04 |
| F3-S04 | API CRUD Knowledge Base + enqueue ingest + envelope kb.document.ingest            | ✅ done | high       | F3-S01                 |
| F3-S05 | Tool search_knowledge_base — retrieval híbrido (vetor + FTS) + ranking + citações | ✅ done | high       | F3-S01, F3-S02         |
| F3-S06 | Frontend KnowledgeBasePage — upload, lista, editor, preview de chunks, status     | ✅ done | high       | F3-S04                 |
| F3-S07 | Feedback loop — citações do agente + marcar útil/não-útil (kb_feedback)           | ✅ done | medium     | F3-S01, F3-S05, F3-S06 |

## Fase 4 — Campaigns

| ID     | Titulo                                                                                              | Status | Prioridade | Depende de             |
| ------ | --------------------------------------------------------------------------------------------------- | ------ | ---------- | ---------------------- |
| F4-S01 | Schema Flow Builder (flows, flow_versions, flow_executions, flow_logs, flow_submissions) + RLS      | ✅ done | critical   | —                      |
| F4-S02 | "@hm/flow-engine core — types + registry + dispatcher + interpolate + stubs de handlers"            | ✅ done | critical   | F4-S01                 |
| F4-S03 | Worker-flows runtime — consumer hm.q.flow.execution + scheduler de wakeup (waiting)                 | ✅ done | high       | F4-S02                 |
| F4-S04 | Handlers de saída — trigger + message + interactive + meta_flow                                     | ✅ done | high       | F4-S02                 |
| F4-S05 | Handlers de lógica/timing — wait + wait_for_response (biestável) + condition + switch               | ✅ done | high       | F4-S02                 |
| F4-S06 | Handlers de sistema/externos — ai_action + change_status + http_request + external_notify           | ✅ done | high       | F4-S02                 |
| F4-S07 | Validação pré-publish — Zod + cycle detection + unreachable nodes + variable refs                   | ✅ done | high       | F4-S02                 |
| F4-S08 | API CRUD flows + publish (version) + trigger manual + executions + cancel + manual-order            | ✅ done | high       | F4-S01, F4-S02, F4-S07 |
| F4-S09 | Frontend FlowsListPage + manual flows drag-reorder                                                  | ✅ done | high       | F4-S08                 |
| F4-S10 | Frontend FlowEditorPage — canvas ReactFlow + palette + inspector shell + toolbar + executions panel | ✅ done | high       | F4-S08, F4-S07         |
| F4-S11 | Frontend node components (15 tipos) — node render + inspector + metadata, 1 pasta por tipo          | ✅ done | high       | F4-S10                 |
| F4-S12 | LiveChat flow integration — quickbar manual + confirm modal + ExecutionsBadge                       | ✅ done | medium     | F4-S08                 |
| F4-S13 | Trigger dispatcher (inbound) — keyword/new_message/new_lead/system_event + resume waiting flows     | ✅ done | high       | F4-S01, F4-S02         |
| F4-S14 | Meta flow_submission webhook + trigger flow (flow_submission)                                       | ✅ done | medium     | F4-S01, F4-S02         |

## Fase 5 — Calendar

| ID     | Titulo                                                                                                    | Status | Prioridade | Depende de             |
| ------ | --------------------------------------------------------------------------------------------------------- | ------ | ---------- | ---------------------- |
| F5-S01 | Schema tags + contact_tags + RLS (destrava conversões e add_tag/remove_tag da F4)                         | ✅ done | critical   | —                      |
| F5-S02 | Schema pipeline (pipelines, stages, deals, deal_history, deal_attachments, pending_automations) + RLS     | ✅ done | critical   | —                      |
| F5-S03 | Schema conversões (conversion_types, conversion_events, conversion_tag_triggers) + RLS + dedup            | ✅ done | high       | F5-S01, F5-S02         |
| F5-S04 | API pipelines + stages (CRUD + reorder)                                                                   | ✅ done | high       | F5-S02                 |
| F5-S05 | API deals + move-stage service (transition rules + history) + close/reopen + attachments                  | ✅ done | high       | F5-S02                 |
| F5-S06 | Automation engine — pending_automations worker + on_stale cron + dispatch from move                       | ✅ done | high       | F5-S02, F5-S05         |
| F5-S07 | Real-time deals — socket events deal:* + relay + client listeners                                         | ✅ done | medium     | F5-S05                 |
| F5-S08 | Agent tools — move_deal_stage + query_deal (agent-runtime)                                                | ✅ done | medium     | F5-S02, F5-S05         |
| F5-S09 | Frontend PipelinePage kanban (dnd-kit + optimistic move + filtros) + PipelineSettingsPage                 | ✅ done | high       | F5-S04, F5-S05         |
| F5-S10 | Frontend DealDetailDrawer + history timeline + CardImageCapture/gallery                                   | ✅ done | high       | F5-S05                 |
| F5-S11 | Frontend custom fields — settings editor + dynamic form renderer + Zod dinâmico                           | ✅ done | medium     | F5-S04                 |
| F5-S12 | API conversões — CRUD conversion_types + events (registrar/listar/cancelar) + dedup                       | ✅ done | high       | F5-S03                 |
| F5-S13 | Frontend conversões — botão "Marcar conversão" + modal + página /conversions + settings                   | ✅ done | medium     | F5-S12                 |
| F5-S14 | Conversões automações — flow handler register_conversion + tag pg-trigger + fecha F2-S20                  | ✅ done | medium     | F5-S03, F5-S06, F5-S12 |
| F5-S15 | Seeds de nicho — pipeline templates (imobiliária + clínica) + agent_template variants + onboarding wizard | ✅ done | medium     | F5-S02, F5-S04         |
| F5-S16 | Fecha stubs da F4 — handlers move_stage/add_tag/remove_tag + triggers stage_change/tag_added              | ✅ done | high       | F5-S01, F5-S02, F5-S05 |

## Fase 6 — Pipeline

| ID     | Titulo                                                                                          | Status | Prioridade | Depende de     |
| ------ | ----------------------------------------------------------------------------------------------- | ------ | ---------- | -------------- |
| F6-S01 | Schema campaigns (+ steps/recipients/deliveries/metrics/followups + scheduled_followups) + RLS  | ✅ done | critical   | —              |
| F6-S02 | Meta error codes map + channel quality/template helpers (packages/channels)                     | ✅ done | high       | —              |
| F6-S03 | API campaigns — CRUD + validate (pre-flight) + activate/pause/resume + metrics/deliveries       | ✅ done | high       | F6-S01, F6-S02 |
| F6-S04 | API recipients (bulk CSV + bulk opt-in) + opt-in/opt-out de contato                             | ✅ done | high       | F6-S01         |
| F6-S05 | Worker-campaigns — tick + send window + rate adaptativo + dispatch idempotente + auto-pause RED | ✅ done | critical   | F6-S01, F6-S02 |
| F6-S06 | Followup processor — scheduled_followups persistente + tick (não setTimeout)                    | ✅ done | medium     | F6-S01, F6-S05 |
| F6-S07 | Inbound hooks — opt-out por keyword + reply handling (mark responded + AI handoff + followup)   | ✅ done | high       | F6-S01         |
| F6-S08 | Frontend CampaignEditor wizard (6 steps) + template picker + CSV import + send windows editor   | ✅ done | high       | F6-S03, F6-S04 |
| F6-S09 | Frontend CampaignsPage + monitoring real-time + health badge                                    | ✅ done | high       | F6-S03         |

## Fase 7 — Dashboard + Conversões

| ID     | Titulo                                                                                                        | Status | Prioridade | Depende de     |
| ------ | ------------------------------------------------------------------------------------------------------------- | ------ | ---------- | -------------- |
| F7-S01 | Schema Calendar (calendars/availability_rules/exceptions/events/participants) + compute_available_slots + RLS | ✅ done | critical   | —              |
| F7-S02 | API calendars + availability (rules/exceptions) + slots endpoint + permissões calendar.*                      | ✅ done | high       | F7-S01         |
| F7-S03 | API events (CRUD + cancel + rsvp) + event service (participants + notification seam)                          | ✅ done | high       | F7-S01, F7-S02 |
| F7-S04 | Agent tools calendar — list_calendars + get_available_slots + schedule_event (callback Node)                  | ✅ done | medium     | F7-S01, F7-S03 |
| F7-S05 | Event reminders cron — scheduler 5min + notification + outbound WhatsApp opcional                             | ✅ done | medium     | F7-S01, F7-S03 |
| F7-S06 | Frontend CalendarPage (FullCalendar month/week/day) + EventForm + nav Agenda                                  | ✅ done | high       | F7-S02, F7-S03 |
| F7-S07 | Frontend AvailabilityRulesPage (settings → calendar) + exceções                                               | ✅ done | medium     | F7-S02         |

## Fase 8 — Permissions & Settings

| ID     | Titulo                                                                                              | Status | Prioridade | Depende de             |
| ------ | --------------------------------------------------------------------------------------------------- | ------ | ---------- | ---------------------- |
| F8-S01 | Schema F8 — dashboard_snapshots + materialized views + departments + teams + SLA config + RLS       | ✅ done | critical   | —                      |
| F8-S02 | Dashboard metrics service + API /dashboard/me (role-filtered) + socket + refresh jobs               | ✅ done | high       | F8-S01                 |
| F8-S03 | Dashboard frontend — DashboardClient + card registry (5 layouts role-aware) + alerts + drill-down   | ✅ done | high       | F8-S02                 |
| F8-S04 | Dashboard customização — layout pessoal (hide/reorder/período) + cards obrigatórios (admin)         | ✅ done | medium     | F8-S02, F8-S03, F8-S05 |
| F8-S05 | Settings panel shell — sidebar 3 níveis + busca Cmd+K + contadores + conteúdo lazy + /settings root | ✅ done | high       | —                      |
| F8-S06 | Settings Pessoal — perfil/preferências/senha/sessões/notificações + API                             | ✅ done | high       | F8-S05                 |
| F8-S07 | Settings Workspace (org) — info/marca/membros/departamentos/times/auto-assign/horário/SLAs + API    | ✅ done | high       | F8-S01, F8-S05         |
| F8-S08 | Settings Workspace (dados) — tags CRUD + integração das seções existentes + audit viewer            | ✅ done | medium     | F8-S05                 |
| F8-S09 | Contacts API — list/search/detail/CRUD + tags + histórico de consentimento                          | ✅ done | high       | —                      |
| F8-S10 | Frontend ContactsPage (CRM) — lista + detalhe + tags + consentimento + marcar conversão + nav       | ✅ done | high       | F8-S09                 |

## Fase 9 — Hardening + Observability

| ID     | Titulo                                                                                                   | Status     | Prioridade | Depende de |
| ------ | -------------------------------------------------------------------------------------------------------- | ---------- | ---------- | ---------- |
| F9-S01 | Schema outbound_webhooks + outbound_webhook_deliveries (+ verificar api_keys) + RLS                      | ✅ done     | critical   | —          |
| F9-S02 | API key auth middleware + rate limit por chave (Redis)                                                   | ✅ done     | high       | F9-S01     |
| F9-S03 | API pública v1 — send_message/template + upsert_contact + trigger_flow + conversations + OpenAPI/Swagger | ✅ done     | high       | F9-S02     |
| F9-S04 | Management CRUD — API keys (create show-once/list/revoke) + webhooks subscriptions                       | 🟣 review   | high       | F9-S01     |
| F9-S05 | Worker-webhooks — event hooks → deliveries + HMAC dispatch + retry exponencial                           | ⏸️ blocked | high       | F9-S01     |
| F9-S06 | Frontend Settings → Dev — API keys (show-once) + webhooks + delivery log                                 | ⏸️ blocked | medium     | F9-S04     |
