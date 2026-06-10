# STATUS — Board de slots

> Atualize via `python scripts/slot.py sync` (NAO edite a mao — slot frontmatters sao a fonte da verdade).

Legenda: `available` 🟢 · `blocked` ⏸️ · `claimed` 🟡 · `in-progress` 🔵 · `review` 🟣 · `done` ✅ · `cancelled` ⚫

## Resumo

| Fase | Total | 🟢  | ⏸️  | 🟡  | 🔵  | 🟣  | ✅  |
| ---- | ----- | --- | --- | --- | --- | --- | --- |
| F0   | 16     | 0   | 0   | 0   | 0   | 0   | 16   |
| F1   | 26     | 0   | 0   | 0   | 0   | 0   | 26   |
| F2   | 21     | 0   | 5   | 0   | 1   | 0   | 15   |

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

| ID     | Titulo                                                                                       | Status        | Prioridade | Depende de             |
| ------ | -------------------------------------------------------------------------------------------- | ------------- | ---------- | ---------------------- |
| F2-S01 | Schema de agentes IA (agents, templates, tools, executions, llm usage, policies)             | ✅ done        | critical   | —                      |
| F2-S02 | Container agent-runtime (FastAPI + LangGraph + LangServe + asyncpg) + logging                | ✅ done        | critical   | —                      |
| F2-S03 | Pacote @hm/agents-client (cliente Node tipado p/ agent-runtime)                              | ✅ done        | critical   | F2-S02                 |
| F2-S04 | OpenRouterProvider (chat completion + streaming + tool calls + usage capture)                | ✅ done        | critical   | F2-S02                 |
| F2-S05 | Grafo LangGraph (load_context → build_prompt → call_model → tools → finalize) + checkpointer | ✅ done        | critical   | F2-S02, F2-S04, F2-S01 |
| F2-S06 | Tool registry + tools "leves" (query_contact/conversation/search_kb) via asyncpg RLS         | ✅ done        | high       | F2-S02, F2-S01, F2-S10 |
| F2-S07 | Tools de negócio via callback HTTP para o Node (internal tools endpoint)                     | ✅ done        | high       | F2-S06, F2-S01         |
| F2-S08 | Policy enforcement no runtime (filtra tools, valida modelo, max_iterations)                  | 🔵 in-progress | high       | F2-S05, F2-S01         |
| F2-S09 | Hard cap de custo no Node antes da chamada ao runtime                                        | ✅ done        | high       | F2-S01, F2-S03         |
| F2-S10 | Column-level access control para tools de database                                           | ✅ done        | medium     | F2-S02                 |
| F2-S11 | Worker de agentes — ai_mode='on' + inbound → agentsClient.run (stream)                       | ✅ done        | critical   | F2-S03, F2-S05, F2-S09 |
| F2-S12 | Aggregation buffer (window_sec) antes de chamar o runtime                                    | ⏸️ blocked    | medium     | F2-S11                 |
| F2-S13 | Cost tracking + agregação de agent_metrics a partir de llm_usage_logs                        | ✅ done        | medium     | F2-S01                 |
| F2-S14 | Seed — 5 agent templates globais + questions + default_tools + default_model                 | ✅ done        | medium     | F2-S01                 |
| F2-S15 | Seed — catálogo inicial llm_models_whitelist (top modelos OpenRouter)                        | ✅ done        | medium     | F2-S01                 |
| F2-S16 | API CRUD agents + tools_global + toggle agent_tools (Node)                                   | ✅ done        | high       | F2-S01, F2-S03         |
| F2-S17 | Frontend AgentsListPage + AgentCreationWizard                                                | ✅ done        | high       | F2-S16, F2-S14, F2-S15 |
| F2-S18 | Frontend AgentDetailPage com tabs (Config, Tools, Knowledge, Metrics, Playground)            | ⏸️ blocked    | medium     | F2-S16, F2-S17         |
| F2-S19 | Playground do agente com SSE streaming (proxy via API Node)                                  | ⏸️ blocked    | medium     | F2-S16, F2-S05, F2-S18 |
| F2-S20 | Tools workflow modulares + register_conversion (respeitando policies)                        | ⏸️ blocked    | medium     | F2-S07, F2-S06         |
| F2-S21 | Auto follow-up cron job idempotente                                                          | ⏸️ blocked    | low        | F2-S11                 |
