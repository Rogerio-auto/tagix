# STATUS — Board de slots

> Atualize via `python scripts/slot.py sync` (NAO edite a mao — slot frontmatters sao a fonte da verdade).

Legenda: `available` 🟢 · `blocked` ⏸️ · `claimed` 🟡 · `in-progress` 🔵 · `review` 🟣 · `done` ✅ · `cancelled` ⚫

## Resumo

| Fase | Total | 🟢  | ⏸️  | 🟡  | 🔵  | 🟣  | ✅  |
| ---- | ----- | --- | --- | --- | --- | --- | --- |
| F0   | 16     | 0   | 0   | 0   | 0   | 0   | 16   |
| F1   | 26     | 0   | 0   | 0   | 0   | 0   | 26   |
| F10   | 13     | 0   | 0   | 0   | 0   | 0   | 13   |
| F15   | 9     | 0   | 0   | 0   | 0   | 0   | 9   |
| F2   | 21     | 0   | 0   | 0   | 0   | 0   | 21   |
| F25   | 9     | 0   | 0   | 0   | 0   | 0   | 9   |
| F26   | 11     | 0   | 0   | 0   | 0   | 0   | 11   |
| F27   | 3     | 0   | 0   | 0   | 0   | 0   | 3   |
| F28   | 2     | 0   | 0   | 0   | 0   | 0   | 2   |
| F29   | 5     | 0   | 0   | 0   | 0   | 0   | 5   |
| F3   | 7     | 0   | 0   | 0   | 0   | 0   | 7   |
| F30   | 11     | 0   | 0   | 0   | 0   | 0   | 11   |
| F31   | 12     | 0   | 0   | 0   | 0   | 0   | 12   |
| F32   | 5     | 0   | 0   | 0   | 0   | 0   | 5   |
| F33   | 3     | 0   | 0   | 0   | 0   | 0   | 3   |
| F34   | 7     | 0   | 0   | 0   | 0   | 0   | 7   |
| F35   | 3     | 0   | 0   | 0   | 0   | 0   | 3   |
| F36   | 14     | 0   | 0   | 0   | 0   | 0   | 14   |
| F37   | 5     | 0   | 0   | 0   | 0   | 0   | 5   |
| F38   | 16     | 0   | 0   | 0   | 0   | 0   | 16   |
| F39   | 5     | 0   | 0   | 0   | 0   | 0   | 5   |
| F4   | 14     | 0   | 0   | 0   | 0   | 0   | 14   |
| F40   | 1     | 1   | 0   | 0   | 0   | 0   | 0   |
| F41   | 3     | 2   | 0   | 0   | 0   | 1   | 0   |
| F5   | 16     | 0   | 0   | 0   | 0   | 0   | 16   |
| F6   | 9     | 0   | 0   | 0   | 0   | 0   | 9   |
| F7   | 7     | 0   | 0   | 0   | 0   | 0   | 7   |
| F8   | 10     | 0   | 0   | 0   | 0   | 0   | 10   |
| F9   | 6     | 0   | 0   | 0   | 0   | 0   | 6   |

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

## Fase 10 — Launch

| ID      | Titulo                                                                                    | Status | Prioridade | Depende de |
| ------- | ----------------------------------------------------------------------------------------- | ------ | ---------- | ---------- |
| F10-S01 | Observability stack — OTLP metrics + Prometheus + Grafana + Sentry (server-side)          | ✅ done | high       | —          |
| F10-S02 | LGPD — data export + delete (direito ao esquecimento)                                     | ✅ done | high       | —          |
| F10-S03 | e2e Playwright — jornada completa (login → canal → msg → agente → flow → deal)            | ✅ done | medium     | —          |
| F10-S04 | Sistema de ajuda contextual inline (?) — HelpHint/HelpPanel + registry                    | ✅ done | medium     | —          |
| F10-S05 | a11y audit + AAA contraste + navegação por teclado                                        | ✅ done | medium     | F10-S04    |
| F10-S06 | Performance audit + bundle optimization + Lighthouse                                      | ✅ done | medium     | F10-S05    |
| F10-S07 | Security hardening (OWASP) — headers/helmet/CORS + sanitização de erro + audit            | ✅ done | high       | —          |
| F10-S08 | Runbooks operacionais — postgres-down, restore-backup, rotate-key, waba-banned            | ✅ done | medium     | —          |
| F10-S09 | Documentação da API pública — site de referência (Mintlify) sobre o OpenAPI v1            | ✅ done | low        | —          |
| F10-S10 | Code-split real das libs pesadas (recharts/xyflow/fullcalendar) via lazyClient            | ✅ done | medium     | —          |
| F10-S11 | Bump de dependências vulneráveis (OWASP A06) — drizzle-orm, OTel, vitest                  | ✅ done | high       | —          |
| F10-S12 | a11y das telas flagship — ChatList (setas), Pipeline (dnd-kit keyboard), ReactFlow canvas | ✅ done | medium     | F10-S10    |
| F10-S13 | Sentry browser — error tracking do cliente web (opt-in, no-op sem DSN)                    | ✅ done | medium     | —          |

## Fase 15

| ID      | Titulo                                                                                      | Status | Prioridade | Depende de       |
| ------- | ------------------------------------------------------------------------------------------- | ------ | ---------- | ---------------- |
| F15-S01 | IG adapter completo — parser + serializer + comments + stories + errors (channels)          | ✅ done | critical   | —                |
| F15-S02 | Webhook IG ingestion — /webhooks/meta parseia entries IG + dedup + enqueue                  | ✅ done | high       | F15-S01          |
| F15-S03 | Inbound persistence IG — worker persiste DM/story/share/comment → conv/messages/ig_comments | ✅ done | high       | F15-S01, F15-S02 |
| F15-S04 | Outbound dispatch IG — worker envia text/media/interactive/comment + janela 24h/MESSAGE_TAG | ✅ done | high       | F15-S01          |
| F15-S05 | IG comments/stories API — endpoints de moderação (reply pub/priv, hide, delete, list)       | ✅ done | high       | F15-S03, F15-S04 |
| F15-S06 | IG connect backend — Embedded Signup + seleção Page/IGBA + webhook subscription + test msg  | ✅ done | high       | F15-S01          |
| F15-S07 | IG connect wizard (frontend) — passo Instagram no ConnectChannelWizard                      | ✅ done | medium     | F15-S06          |
| F15-S08 | IG inbox UI — ícone/filtro de canal, comment thread, story mention card, composer 24h/tag   | ✅ done | medium     | F15-S05          |
| F15-S09 | IG App Review runbook + opt-out keyword parity + PII redact docs                            | ✅ done | low        | —                |

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

## Fase 25

| ID      | Titulo                                                                                  | Status | Prioridade | Depende de                |
| ------- | --------------------------------------------------------------------------------------- | ------ | ---------- | ------------------------- |
| F25-S01 | Platform-admin guard — middleware requirePlatformAdmin (API)                            | ✅ done | critical   | —                         |
| F25-S02 | LLM models catalog API — CRUD llm_models_whitelist + sync OpenRouter /models            | ✅ done | high       | F25-S01                   |
| F25-S03 | Workspace agent policies API — editor por workspace (allowed_models, features, caps)    | ✅ done | high       | F25-S01                   |
| F25-S04 | Platform secrets rotation API — rotaciona OpenRouter/Meta/encryption keys + auditoria   | ✅ done | high       | F25-S01                   |
| F25-S05 | LLM usage rollup API — gasto por workspace/modelo/dia-mês + top spenders + caps         | ✅ done | high       | F25-S01                   |
| F25-S06 | Platform-admin frontend shell — route group (platform) + guard + nav                    | ✅ done | high       | —                         |
| F25-S07 | Páginas Modelos + Políticas (frontend) — catálogo LLM + editor de policy por workspace  | ✅ done | medium     | F25-S02, F25-S03, F25-S06 |
| F25-S08 | Páginas Secrets + Uso (frontend) — rotação de platform_secrets + dashboard de custo LLM | ✅ done | medium     | F25-S04, F25-S05, F25-S06 |
| F25-S09 | Runbooks de plataforma — rotate-openrouter-key + manage-workspace-agent-policy          | ✅ done | low        | —                         |

## Fase 26

| ID      | Titulo                                                                                     | Status | Prioridade | Depende de       |
| ------- | ------------------------------------------------------------------------------------------ | ------ | ---------- | ---------------- |
| F26-S01 | Schema — impersonation_sessions + workspace_entitlement_overrides + llm_usage_logs.is_test | ✅ done | critical   | —                |
| F26-S02 | Workspaces API — list de tenants + Workspace 360 agregado                                  | ✅ done | high       | —                |
| F26-S03 | Plans CRUD API — catálogo de planos (limits/features tipados, sem Stripe)                  | ✅ done | high       | —                |
| F26-S04 | Subscriptions API por tenant + resolveEntitlements (plano + override)                      | ✅ done | high       | F26-S01          |
| F26-S05 | Impersonation API + middleware — view-as READ-ONLY (time-boxed, auditado, no-secrets)      | ✅ done | high       | F26-S01          |
| F26-S06 | Agent sandbox — mode:'sandbox' no /run (tool-executor mock, no-persist, custo is_test)     | ✅ done | high       | F26-S01          |
| F26-S07 | Tenants list + Workspace 360 UI (frontend platform-admin)                                  | ✅ done | medium     | F26-S02          |
| F26-S08 | Planos + Assinatura/Entitlements UI (frontend platform-admin)                              | ✅ done | medium     | F26-S03, F26-S04 |
| F26-S09 | View-as UI — botão "Ver como", banner global persistente, kill-switch, sessões ativas      | ✅ done | medium     | F26-S05          |
| F26-S10 | Agent Playground UI — chat de teste + trace de execução + seletor de modelo/params         | ✅ done | medium     | F26-S06          |
| F26-S11 | Runbooks de plataforma + revisão de segurança da impersonation                             | ✅ done | medium     | —                |

## Fase 27

| ID      | Titulo                                                          | Status | Prioridade | Depende de |
| ------- | --------------------------------------------------------------- | ------ | ---------- | ---------- |
| F27-S01 | PageContainer primitive + token de largura de conteúdo (DS)     | ✅ done | high       | —          |
| F27-S02 | Aplicar PageContainer nas telas de lista/detalhe do grupo (app) | ✅ done | high       | F27-S01    |
| F27-S03 | Aplicar PageContainer em settings/forms + validar full-bleed    | ✅ done | medium     | F27-S01    |

## Fase 28

| ID      | Titulo                                                                        | Status | Prioridade | Depende de |
| ------- | ----------------------------------------------------------------------------- | ------ | ---------- | ---------- |
| F28-S01 | Dashboard Onda A — métricas backend (performance atendente, rankings, IA ops) | ✅ done | high       | —          |
| F28-S02 | Dashboard Onda A — frontend (TableCard rico, rankings, cards IA)              | ✅ done | high       | F28-S01    |

## Fase 29

| ID      | Titulo                                                                  | Status | Prioridade | Depende de       |
| ------- | ----------------------------------------------------------------------- | ------ | ---------- | ---------------- |
| F29-S01 | Schema — conversation_evaluations + objections + RLS + repos            | ✅ done | critical   | —                |
| F29-S02 | LLM-judge no agent-runtime — POST /internal/evaluate                    | ✅ done | high       | —                |
| F29-S03 | Worker de avaliação — polling de conversas encerradas → judge → persist | ✅ done | high       | F29-S01, F29-S02 |
| F29-S04 | Dashboard Onda B — métricas backend (qualidade, CSAT, objeções)         | ✅ done | high       | F29-S01          |
| F29-S05 | Dashboard Onda B — frontend (cards qualidade/CSAT + objeções rankeadas) | ✅ done | medium     | F29-S04          |

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

## Fase 30

| ID        | Titulo                                                                   | Status | Prioridade | Depende de                |
| --------- | ------------------------------------------------------------------------ | ------ | ---------- | ------------------------- |
| F30-S01   | Foundation — schema visibilidade/peer + ai-handoff + contratos shared    | ✅ done | critical   | —                         |
| F30-S02   | API de estado da conversa — status + ai_mode toggle                      | ✅ done | high       | F30-S01                   |
| F30-S03   | Inbox UI — cockpit no painel + header espelho + filtros                  | ✅ done | high       | F30-S01, F30-S02, F30-S07 |
| F30-S04   | IA handoff — auto-pausa ao humano responder                              | ✅ done | high       | F30-S01, F30-S02          |
| F30-S05   | Agent-runtime — retomada consciente de contexto (handoff)                | ✅ done | high       | F30-S01                   |
| F30-S06   | Gatilhos de reengajamento da IA — cron (ocioso/fora-horário)             | ✅ done | medium     | F30-S01, F30-S04, F30-S05 |
| F30-S07   | Enforcement de visibilidade na lista de conversas                        | ✅ done | critical   | F30-S01                   |
| F30-S08   | API de configuração de visibilidade + peer-privacy                       | ✅ done | high       | F30-S01                   |
| F30-S09   | Auto-assign engine no inbound (round-robin/least-busy)                   | ✅ done | high       | F30-S01                   |
| F30-S10   | Settings UI — visibilidade + peer-privacy por time                       | ✅ done | medium     | F30-S08                   |
| F30-S07.1 | Guard de visibilidade por-conversa nos endpoints por-id (hardening IDOR) | ✅ done | critical   | F30-S07                   |

## Fase 31

| ID      | Titulo                                                                     | Status | Prioridade | Depende de                                                                      |
| ------- | -------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------- |
| F31-S01 | Bridge de saída real do flow (FlowOutboundMessage → OutboundJob)           | ✅ done | critical   | —                                                                               |
| F31-S02 | Node de mensagem rico (texto / mídia / voz / áudio-arquivo)                | ✅ done | high       | F31-S01                                                                         |
| F31-S03 | Infra de contexto — helpers-context + VariablesPicker completos            | ✅ done | high       | —                                                                               |
| F31-S04 | Inspector interactive completo (botões reply/url/phone + listas)           | ✅ done | high       | F31-S01, F31-S03                                                                |
| F31-S05 | Inspector http_request completo (headers/body/retry/map-resposta)          | ✅ done | medium     | F31-S03                                                                         |
| F31-S06 | Inspectors condition (pickers+business-hours), external_notify e ai_action | ✅ done | medium     | F31-S01, F31-S03                                                                |
| F31-S07 | Triggers configuráveis (tipo editável + trigger_config UI)                 | ✅ done | high       | F31-S03                                                                         |
| F31-S08 | Scaffold dos novos nodes + limpeza do catálogo (espinha)                   | ✅ done | high       | F31-S03                                                                         |
| F31-S09 | Nodes set_variable + input (variáveis & captura validada)                  | ✅ done | medium     | F31-S08, F31-S01                                                                |
| F31-S10 | Nodes assign + template/HSM (atendimento)                                  | ✅ done | medium     | F31-S08, F31-S01                                                                |
| F31-S11 | Nodes ab_split + go_to_flow + UI de register_conversion                    | ✅ done | medium     | F31-S08                                                                         |
| F31-S12 | Docs FLOW_BUILDER + e2e Playwright do builder v2                           | ✅ done | medium     | F31-S01, F31-S02, F31-S04, F31-S05, F31-S06, F31-S07, F31-S09, F31-S10, F31-S11 |

## Fase 32

| ID      | Titulo                                                          | Status | Prioridade | Depende de |
| ------- | --------------------------------------------------------------- | ------ | ---------- | ---------- |
| F32-S01 | Delete node — teclado + botão + guard trigger                   | ✅ done | high       | —          |
| F32-S02 | Inspectors add_tag + remove_tag com TagPicker real              | ✅ done | high       | —          |
| F32-S03 | Inspector move_stage com PipelinePicker + StagePicker           | ✅ done | high       | —          |
| F32-S04 | Inspector switch completo — case management + edges dinâmicas   | ✅ done | medium     | —          |
| F32-S05 | Inspector meta_flow completo (body, flowToken, screen, payload) | ✅ done | medium     | —          |

## Fase 33

| ID      | Titulo                                                      | Status | Prioridade | Depende de |
| ------- | ----------------------------------------------------------- | ------ | ---------- | ---------- |
| F33-S01 | go_to_flow — enqueue step do flow filho no dispatcher       | ✅ done | high       | —          |
| F33-S02 | Bridge interactive + template no outbound-publisher do flow | ✅ done | high       | —          |
| F33-S03 | ConversionTypePicker + FlowPicker nos inspectors            | ✅ done | medium     | —          |

## Fase 34

| ID      | Titulo                                                                 | Status | Prioridade | Depende de |
| ------- | ---------------------------------------------------------------------- | ------ | ---------- | ---------- |
| F34-S01 | Schema agent_departments (N:N agente↔departamento) + RLS + repo        | ✅ done | critical   | —          |
| F34-S02 | Config de departamentos no editor de agente (API + UI)                 | ✅ done | high       | —          |
| F34-S03 | Resolução department-aware do agente em loadContext                    | ✅ done | high       | —          |
| F34-S04 | Troca manual de agente no cockpit (endpoint + UI + socket + permissão) | ✅ done | high       | —          |
| F34-S05 | Tool transfer_to_agent — handler Node + authz de alvo + re-engaje      | ✅ done | medium     | —          |
| F34-S06 | Runtime — tool transfer_to_agent, diretriz de prompt e contexto IA→IA  | ✅ done | medium     | —          |
| F34-S07 | E2E + docs do roteamento agente↔departamento e handoff                 | ✅ done | medium     | —          |

## Fase 35

| ID      | Titulo                                                          | Status | Prioridade | Depende de |
| ------- | --------------------------------------------------------------- | ------ | ---------- | ---------- |
| F35-S01 | CRUD de pipelines na Settings + mutations reutilizáveis         | ✅ done | high       | —          |
| F35-S02 | Limite máximo de pipelines por workspace (backend)              | ✅ done | high       | —          |
| F35-S03 | Board — seletor de pipeline melhorado + empty state + CTA criar | ✅ done | medium     | F35-S01    |

## Fase 36

| ID      | Titulo                                                              | Status | Prioridade | Depende de |
| ------- | ------------------------------------------------------------------- | ------ | ---------- | ---------- |
| F36-S01 | Primitivos responsivos — Sheet, useBreakpoint, safe-area, MOBILE_UX | ✅ done | critical   | —          |
| F36-S02 | Casca mobile (bottom nav + drawer) + PWA instalável                 | ✅ done | critical   | —          |
| F36-S03 | Inbox/cockpit responsivo — pilha de views + sheets                  | ✅ done | high       | —          |
| F36-S04 | Pipeline/kanban responsivo — seletor de estágio + lista             | ✅ done | high       | —          |
| F36-S05 | Padrão Tabela→Cards + filtros em sheet (primitivo + contatos)       | ✅ done | high       | —          |
| F36-S06 | Dashboard responsivo — grid→coluna + charts responsivos             | ✅ done | medium     | —          |
| F36-S07 | Calendário responsivo — agenda/dia no mobile                        | ✅ done | medium     | —          |
| F36-S08 | Agentes responsivos — lista + detalhe com abas                      | ✅ done | medium     | —          |
| F36-S09 | Campanhas responsivas — lista + wizard + monitoring                 | ✅ done | medium     | —          |
| F36-S10 | Settings + Knowledge + Conversões responsivos                       | ✅ done | medium     | —          |
| F36-S11 | Flow Builder mobile — inspecionar/operar (read-first)               | ✅ done | medium     | —          |
| F36-S12 | Auth (login/reset) — polish mobile                                  | ✅ done | low        | —          |
| F36-S13 | Platform admin legível/operável no mobile                           | ✅ done | low        | —          |
| F36-S14 | QA mobile + audit de UX + performance (fechamento)                  | ✅ done | medium     | —          |

## Fase 37

| ID      | Titulo                                                                         | Status | Prioridade | Depende de |
| ------- | ------------------------------------------------------------------------------ | ------ | ---------- | ---------- |
| F37-S01 | Calendar 2.0 — schema recorrência + provisionamento + helper de acesso         | ✅ done | critical   | —          |
| F37-S02 | Calendar 2.0 — API (visibilidade + recorrência + provisionamento)              | ✅ done | critical   | —          |
| F37-S03 | Calendar 2.0 — desktop (trilha multi-calendário + agendamento rico + form 2.0) | ✅ done | high       | —          |
| F37-S04 | Calendar 2.0 — mobile (trilha como sheet + cor por calendário)                 | ✅ done | medium     | —          |
| F37-S05 | Calendar 2.0 — QA + audit (regressão do vazamento) + docs                      | ✅ done | medium     | —          |

## Fase 38 — Suporte ao Cliente (Help Center + Live Support + Dev Portal)

| ID      | Titulo                                                          | Status | Prioridade | Depende de |
| ------- | --------------------------------------------------------------- | ------ | ---------- | ---------- |
| F38-S01 | Schema Help + Support (5 tabelas) + RLS + repos + seed          | ✅ done | critical   | —          |
| F38-S02 | API CMS Help Center (CRUD + publish), platform-admin            | ✅ done | high       | —          |
| F38-S03 | API leitor de ajuda (list/get/anchor + busca FTS + feedback)    | ✅ done | high       | —          |
| F38-S04 | UI CMS Help no (platform) — lista + editor MD + publish         | ✅ done | high       | —          |
| F38-S05 | UI leitor /help + entrada de nav "Ajuda"                        | ✅ done | high       | —          |
| F38-S06 | Help contextual (?) — HelpHint em @hm/ui + anchors nas features | ✅ done | medium     | —          |
| F38-S07 | API suporte do membro (abrir/listar/responder/resolver)         | ✅ done | high       | —          |
| F38-S08 | Real-time suporte (Socket.io rooms + relay)                     | ✅ done | high       | —          |
| F38-S09 | UI launcher + chat de suporte no (app)                          | ✅ done | high       | —          |
| F38-S10 | API inbox de suporte no (platform) — triagem/reply/status       | ✅ done | high       | —          |
| F38-S11 | UI inbox de suporte no (platform) — real-time                   | ✅ done | high       | —          |
| F38-S12 | Novos endpoints API pública v1 + OpenAPI + scopes + testes      | ✅ done | high       | —          |
| F38-S13 | Portal do Desenvolvedor in-product (DS v2, render do OpenAPI)   | ✅ done | high       | —          |
| F38-S14 | QA da fase (integration + e2e happy paths)                      | ✅ done | high       | —          |
| F38-S15 | Auditoria de segurança da fase (RLS, gates, XSS MD, scopes)     | ✅ done | critical   | —          |
| F38-S16 | Fix 500 no dedup de conversões (ON CONFLICT DO NOTHING)         | ✅ done | high       | —          |

## Fase 39

| ID      | Titulo                                                                                            | Status | Prioridade | Depende de                         |
| ------- | ------------------------------------------------------------------------------------------------- | ------ | ---------- | ---------------------------------- |
| F39-S01 | WhatsApp connect backend — Embedded Signup server-side (Cloud API + coexistência onboarding)      | ✅ done | critical   | —                                  |
| F39-S02 | WhatsApp connect wizard UI — Embedded Signup (FB Login) + seleção de número + modo coexistência   | ✅ done | high       | F39-S01                            |
| F39-S03 | Ingestão de webhooks de coexistência — parse de history / smb_message_echoes / smb_app_state_sync | ✅ done | high       | F39-S01                            |
| F39-S04 | Workers de sync de coexistência — echoes → conversas, import de histórico, app_state              | ✅ done | high       | F39-S03                            |
| F39-S05 | Validação E2E Meta + runbook de conexão WhatsApp/coexistência                                     | ✅ done | medium     | F39-S01, F39-S02, F39-S03, F39-S04 |

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

## Fase 40

| ID      | Titulo                                                                             | Status      | Prioridade | Depende de |
| ------- | ---------------------------------------------------------------------------------- | ----------- | ---------- | ---------- |
| F40-S01 | Fix RLS — GUC app.workspace_id vazio ('') quebra queries cross-tenant (schedulers) | 🟢 available | high       | —          |

## Fase 41 — Portal do Desenvolvedor — Referência rica + Console Try-it

| ID      | Titulo                                                                      | Status      | Prioridade | Depende de |
| ------- | --------------------------------------------------------------------------- | ----------- | ---------- | ---------- |
| F41-S01 | Referência por endpoint — request body + params + response + exemplo gerado | 🟣 review    | high       | —          |
| F41-S02 | Console "Try it" — Sandbox (mock) + Real (API key, GET-only)                | 🟢 available | high       | —          |
| F41-S03 | QA + revisão de segurança do console (não misturar)                         | 🟢 available | high       | —          |

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

| ID     | Titulo                                                                                                   | Status | Prioridade | Depende de |
| ------ | -------------------------------------------------------------------------------------------------------- | ------ | ---------- | ---------- |
| F9-S01 | Schema outbound_webhooks + outbound_webhook_deliveries (+ verificar api_keys) + RLS                      | ✅ done | critical   | —          |
| F9-S02 | API key auth middleware + rate limit por chave (Redis)                                                   | ✅ done | high       | F9-S01     |
| F9-S03 | API pública v1 — send_message/template + upsert_contact + trigger_flow + conversations + OpenAPI/Swagger | ✅ done | high       | F9-S02     |
| F9-S04 | Management CRUD — API keys (create show-once/list/revoke) + webhooks subscriptions                       | ✅ done | high       | F9-S01     |
| F9-S05 | Worker-webhooks — event hooks → deliveries + HMAC dispatch + retry exponencial                           | ✅ done | high       | F9-S01     |
| F9-S06 | Frontend Settings → Dev — API keys (show-once) + webhooks + delivery log                                 | ✅ done | medium     | F9-S04     |
