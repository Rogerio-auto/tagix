# FEATURES — Inventário e classificação

> **Documento:** Inventário completo de features do v1 com classificação **keep / rewrite / discard** para o v2
> **Versão:** 0.1 — 2026-06-06

---

## Legenda

| Símbolo | Significado |
|---|---|
| ✅ Keep | Reaproveita conceito + parte do código (refatorado). Está no MVP. |
| 🔄 Rewrite | Conceito é bom, implementação não. Reescreve do zero no v2. Está no MVP. |
| ⏸️ Defer | Boa ideia, fora do MVP. Vai pra fase 2+. |
| ❌ Discard | Não faz sentido no v2. Desaparece. |
| ❓ Decidir | Aguarda decisão do Rogério na revisão. |

---

## 1. Auth & Workspace

| Feature v1 | Status | Razão / Detalhe |
|---|---|---|
| Login email/senha (Supabase Auth) | 🔄 Rewrite | Manter Supabase Auth atrás de `IAuthProvider`; refatorar fluxo no v2 com React Hook Form |
| Reset password | 🔄 Rewrite | Fluxo simples; reescreve com DS v2 |
| Cadastro multi-step wizard | ⏸️ Defer | Fase 2; MVP usa Supabase Auth direto + workspace setup mínimo |
| Onboarding modal | ⏸️ Defer | Fase 2 |
| 6 roles (USER/AGENT/SUPERVISOR/TECHNICIAN/MANAGER/ADMIN/SUPER_ADMIN) | 🔄 Rewrite | Reduzir para 5: OWNER, ADMIN, SUPERVISOR, AGENT, READONLY. Super-admin vira flag `is_platform_admin` |
| Convite de membro | 🔄 Rewrite | Refatorar com email tokens + RHF |
| Multi-tenant manual filtering (sem RLS) | 🔄 Rewrite | RLS desde o início no v2 |
| Subscription middleware com Stripe | 🔄 Rewrite | Schema preparado, feature flag `BILLING_ENABLED=false` no MVP |
| Bootstrap data fetch (`/api/bootstrap`) | ✅ Keep | Conceito bom; refatorar tipos |
| Theme preference persistence (DB) | ✅ Keep | Mantém com tabela `members.theme_preference` |
| API keys com scopes | ✅ Keep | SHA-256 hash + scopes array; sigue v1 |

---

## 2. LiveChat (núcleo)

| Feature v1 | Status | Razão / Detalhe |
|---|---|---|
| Provider Meta Cloud API (WhatsApp) | ✅ Keep | Refatora limpo no `packages/channels/meta/whatsapp/`; provider renomeado `meta_whatsapp` |
| Provider WAHA (HTTP) | ✅ Keep | Refatora limpo no `packages/channels/waha/` |
| **Provider Meta Instagram Messaging** | ✅ Add (schema-ready MVP, impl F1.5) | **NOVO no v2**. Mesmo Meta App como Tech Provider único. Schema/interface/webhook unificado prontos no MVP; adapter completo (DMs + stories + comments) na F1.5. Detalhe: [`features/INSTAGRAM.md`](./features/INSTAGRAM.md) |
| Provider Baileys (lib) | ❌ Discard | Não está em uso ativo; WAHA cobre |
| Inbox (renomeado para Channel) | 🔄 Rewrite | Reescreve com schema novo (channels + channel_secrets) |
| Webhook Meta + signature verification | ✅ Keep | Mantém HMAC verification rigorosa |
| Webhook dedup via `webhook_events` | ✅ Keep | Tabela mantida |
| RabbitMQ `q.inbound.message` | ✅ Keep | Mesma topologia, renamed `hm.q.inbound.message` |
| Worker inbound | 🔄 Rewrite | Composition limpa, sem `worker.ts` monolítico |
| Worker outbound (4 módulos parse→dispatch→process→finalize) | ✅ Keep | Excelente decomposição; replica |
| Per-chat distributed lock (FX-007) | ✅ Keep | TTL 90s; mantém |
| 24h Meta window lock no composer (FX-011) | ✅ Keep | UX importante |
| Typing/recording presence (FX-008/FX-025) | ✅ Keep | Manter; meta_message_handler corrigido |
| Mensagens de texto, mídia, áudio, vídeo, documento, sticker | ✅ Keep | Cobre todos os tipos |
| Mensagens interactive (buttons, list) | 🔄 Rewrite | Tipar `interactive_payload` com discriminated union em packages/shared (resolve FX-023d) |
| Mensagens template Meta (HSM) | ✅ Keep | Componente bem mapeado |
| Mensagens voice vs audio_file (FX-026) | ✅ Keep | Lógica explícita em `audio_message_kind` |
| Read receipts (delivery status) | ✅ Keep | Mantém pipeline de status |
| Mentions (@membro) em notas internas | ✅ Keep | `conversation_notes.mentions[]` |
| Mentions em mensagens normais | ❌ Discard | Decisão PRD §3.3 #5 — mantém só em notas internas |
| Auto-assign por departamento/time | ✅ Keep | Lógica simplificada |
| Manual assign | ✅ Keep | UX direto |
| Transferência com audit (chat_routing_history) | ✅ Keep | Mantém |
| Conversation status (OPEN/PENDING/CLOSED/AI/RESOLVED) | 🔄 Rewrite | Separar: `status` + `ai_mode` ortogonal (resolve confusão v1) |
| Cache matrix 16+ keys/chat | 🔄 Rewrite | Key versioning em vez de invalidate manual |
| Socket relay via RabbitMQ | ✅ Keep | Pattern excelente; mantém |
| Socket rooms (`user:`, `company:`) | ✅ Keep | Renomeia para `member:` e `workspace:` |
| Stale recovery (FX-016) | ✅ Keep | Lógica importante |
| Single socket provider (FX-022) | ✅ Keep | Provider único; importante |
| Frontend ChatList | 🔄 Rewrite | DS v2 + Zustand para active chat state |
| Frontend MessageBubble | 🔄 Rewrite | DS v2 + discriminated union para interactive |
| Frontend MessageComposer (extrair como component) | 🔄 Rewrite | Drawing do EmpresaPanel refactor; extrai como component dedicado |
| Mídia: download via Meta → R2 (sem proxy do v1) | 🔄 Rewrite | Driver R2 + signed URLs em vez de proxy backend |
| AES-256-GCM em URLs de mídia legacy | ❌ Discard | R2 + signed URLs torna proxy desnecessário |
| AES-256-GCM em tokens em DB | ✅ Keep | Mantém pra `channel_secrets.access_token_enc` |
| `chat_attachments` table | ❌ Discard | Migra pra `messages.media_*` columns único |
| Solar/industry-specific config | ❌ Discard | Não é genérico; era vertical específica do v1 |

---

## 3. Agentes IA

| Feature v1 | Status | Razão / Detalhe |
|---|---|---|
| Runtime custom (`agents-runtime.service.ts` 702 linhas) | 🔄 Rewrite | Substitui por **LangGraph Python** em microsserviço dedicado (`apps/agent-runtime/`); Node chama via HTTP/SSE |
| OpenAI SDK 6 (chat) | 🔄 Rewrite | Substituído por **OpenRouter** como roteador multi-model; api key da plataforma cifrada em `platform_secrets`; modelos restritos por workspace (`workspace_agent_policies.allowed_models`) |
| OpenAI SDK 6 (embeddings, transcription, vision, TTS) | ✅ Keep | Mantido direto (OpenRouter não roteia esses) |
| **Multi-model abstraction** | ✅ Add | **NOVO no v2 — agora no MVP via OpenRouter**, não fase 2. Trocar de OpenAI → Anthropic → Google é mudar slug de modelo |
| **Super-admin: whitelist de modelos OpenRouter por workspace** | ✅ Add | **NOVO no v2**. Tabelas `llm_models_whitelist` (catálogo global) + `workspace_agent_policies.allowed_models` (override per-workspace) |
| **Super-admin: features LangGraph por workspace** | ✅ Add | **NOVO no v2**. `workspace_agent_policies` controla streaming, interrupts, parallel tools, vision, transcription, checkpoints, max_iterations, caps |
| **Cost tracking multi-provider** | ✅ Add | **NOVO no v2**. `llm_usage_logs` registra `router`, `openrouter_generation_id`, `upstream_provider`, `cost_usd` por chamada |
| 5 templates seed (sales/reception/support/first_touch/follow_up) | ✅ Keep | Excelente; replicar prompts no v2 |
| Custom templates por workspace | ✅ Keep | `agent_templates` table |
| Template questions customizáveis | ✅ Keep | `agent_template_questions` |
| Tools catalog | 🔄 Rewrite | Estrutura plugin em `packages/agents/src/tools/<category>/` |
| 4 handler types (INTERNAL_DB, HTTP, WORKFLOW, SOCKET) | 🔄 Rewrite | Renomear: database, http, workflow, calendar, knowledge |
| Column-level access control | ✅ Keep | allowed_columns / restricted_columns mantém |
| Tool logs (agent_tool_logs) | ✅ Keep | Renamed `tool_logs` |
| Knowledge base com full-text search | 🔄 Rewrite | Adicionar pgvector + embeddings + chunking |
| `search_knowledge_base` RPC | 🔄 Rewrite | Tool com vector search + fallback FTS |
| KB hierarchy (parent_id) | ❓ Decidir | Útil? Ou só category é suficiente? |
| KB feedback (helpful/unhelpful) | ✅ Keep | Tabela `kb_feedback` |
| Cost tracking detalhado (MODEL_PRICING) | ✅ Keep | Mantém preços; estende para Anthropic depois |
| `openai_usage_logs` | ✅ Keep | Mantém |
| Context Redis (TTL 1h, max 20 turnos) | 🔄 Rewrite | LangGraph PostgresCheckpointer |
| `agent_context.service.ts` | ❌ Discard | Substituído pelo state graph |
| `agent-templates.service.ts` | ✅ Keep | Refator simples |
| Playground | ✅ Keep | Endpoint dedicado com `isPlayground` flag em ToolContext |
| Auto follow-up (`autoAgentFollowup.ts`) | 🔄 Rewrite | Idempotente com `agent_executions` lookup |
| Aggregation window (buffer 20s) | ✅ Keep | Lógica fica no worker-inbound antes de chamar `runAgent` |
| Streaming response | 🔄 Rewrite | LangGraph Python → LangServe SSE → API Node proxy → frontend |
| Human-in-the-loop / interrupt | ✅ Add (schema-ready) | LangGraph Python suporta nativamente; flag por workspace em `workspace_agent_policies.allow_interrupts`. UI de aprovação completa fica fase 2 |
| Multi-model abstraction | ✅ Add (no MVP via OpenRouter) | Não fica mais para fase 2 — roteador único desde dia 1 |
| Prompt versioning | ⏸️ Defer | Fase 2 |
| Vision (gpt-4o vision) | ✅ Keep | Mantém capability |
| Transcription (whisper-1) | ✅ Keep | Mantém capability |
| TTS (text-to-speech) | ⏸️ Defer | Não usado no v1 ativamente |
| AgentStatusBadge | ✅ Keep | Refatorar com DS v2 |
| Agent metrics (cost tracker, latency) | ✅ Keep | Refatora dashboard |
| Conversation history em playground | ✅ Keep | UI feature |

---

## 4. Flow Builder

| Feature v1 | Status | Razão / Detalhe |
|---|---|---|
| Engine custom (`flow-engine.service.ts`) | 🔄 Rewrite | Reescrever limpo em `packages/flow-engine/`; mantém conceito |
| 14 handlers (trigger, message, interactive, wait, wait_for_response, condition, switch, ai_action, add_tag, move_stage, change_status, http_request, external_notify, meta_flow) | ✅ Keep | Replicar todos os handlers |
| Estados RUNNING/WAITING/COMPLETED/FAILED/CANCELLED | ✅ Keep | Manter |
| `flow_executions` com `variables` JSONB | ✅ Keep | Estrutura idêntica |
| `flow_logs` (audit) | ✅ Keep | Mantém |
| `flow_submissions` (Meta Flows) | ✅ Keep | Mantém |
| RabbitMQ `q.flow.execution` | ✅ Keep | Renamed `hm.q.flow.execution` |
| Worker flows | 🔄 Rewrite | Composition limpa |
| Triggers: STAGE_CHANGE, TAG_ADDED, KEYWORD, NEW_LEAD, NEW_MESSAGE, SYSTEM_EVENT, FLOW_SUBMISSION, MANUAL | ✅ Keep | Todos mantém |
| Variable interpolation (`{{var.dot.notation}}`) | ✅ Keep | Util simples |
| Pre-action typing/recording | ✅ Keep | FX-008 / FX-025 |
| Manual flows quickbar (FX-029d) | ✅ Keep | UX excelente |
| Manual flows drag-and-drop reorder (FX-029a/b/c) | ✅ Keep | Mantém |
| Confirm modal antes de disparar manual (FX-031a) | ✅ Keep | UX bom |
| Flow executions endpoint (FX-031b) | ✅ Keep | API útil |
| FlowExecutionsBadge ChatHeader (FX-031c) | ✅ Keep | UI util |
| FlowExecutions badge ChatList (FX-031d) | ✅ Keep | UI util |
| Auto-promover lead→customer ao disparar flow (FX-030) | 🔄 Rewrite | Substituído por `deals.contact_id` (sempre vincula contact) |
| Versionamento de flow | 🔄 Rewrite | **NOVO no v2**: `flow_versions` snapshot ao publicar |
| Frontend ReactFlow editor | ✅ Keep | Refatora com DS v2 |
| Nodes em pastas separadas (F2-S04) | ✅ Keep | Excelente; replicar |
| FlowHelpersContext | ✅ Keep | Padrão útil |
| Validation Zod no save (F2-S05) | ✅ Keep | Importantíssimo |
| Confirm close unsaved (FX-004) | ✅ Keep | UX |
| Snap magnético em conexões (FX-010) | ✅ Keep | UX bom |
| Node inválido visual indicator (FX-006) | ✅ Keep | UX |
| Double-click abre settings (FX-009) | ✅ Keep | UX |
| Confirm modal manual flow | ✅ Keep | FX-031a |

---

## 5. Pipeline (Funil)

| Feature v1 | Status | Razão / Detalhe |
|---|---|---|
| Dupla estrutura (kanban_columns + project_stages) | 🔄 Rewrite | Unificar em `pipelines + stages + deals` |
| `kanban_colum_id` (typo) | ❌ Discard | Substituído por `deals.stage_id` |
| `leads` table mínima | ❌ Discard | Substituído por `contacts` + `deals` |
| Frontend Funil com dnd-kit | 🔄 Rewrite | Refator com DS v2; mantém dnd-kit |
| KanbanSetupModal | ✅ Keep | Refator |
| CardImageCapture (GPS, EXIF) | ✅ Keep | Bom componente; refator visual + persistência em `deal_attachments` |
| CardImageGallery | ✅ Keep | Refator |
| ImageWithMetadata (canvas overlay) | ✅ Keep | Refator |
| LeadPicker | 🔄 Rewrite | Conceito mantém; vira ContactPicker + cria deal |
| LeadTaskBadge | ✅ Keep | Refator |
| Stage automation (`automation_rules` JSONB) | ✅ Keep | Schema melhor no v2 com flow_engine integration |
| Stage transition rules | ✅ Add | **NOVO no v2**: required_fields, requires_approval, required_role |
| Event sourcing (`deal_history`) | ✅ Add | **NOVO no v2**: substitui `project_activities` falho |
| Real-time sync Socket.IO de kanban | ✅ Add | **NOVO no v2**: mover card sincroniza entre devs |
| Sub-tasks no deal (`deal_tasks`) | ❌ Discard | Decisão PRD §3.3 #1 — sistema de tarefas fora do escopo do v2 |
| Custom fields no deal | ✅ Keep | JSONB + UI builder simples |
| Project templates por indústria (solar, construção do v1) | ❌ Discard como estavam, ✅ Reframe | Nichos antigos descartados (PRD §3.3 #2). Conceito de **template por nicho sobrevive em `agent_templates.industry` + `pipelines.industry`** para os nichos novos do v2: digital marketing, escritórios, imobiliárias, clínicas, advocacias (PRD §3.3 #4) |
| `project_activities` | ❌ Discard | Substituído por `deal_history` |
| `project_comments` (threaded) | ⏸️ Defer | Fase 2 |
| `project_attachments` separado | ❌ Discard | Unificado em `deal_attachments` |

---

## 6. Campanhas

| Feature v1 | Status | Razão / Detalhe |
|---|---|---|
| Tipos: BROADCAST, DRIP, TRIGGERED | ✅ Keep | Substitui `API` por `triggered` |
| Steps com template Meta | ✅ Keep | Refatorar |
| Recipients table | ✅ Keep | Renamed |
| Deliveries table com tracking | ✅ Keep | Idempotency key novo |
| Followups | ✅ Keep | Substituir setTimeout por scheduler |
| Rate limit per minute | ✅ Keep | Adaptativo baseado em quality |
| Daily limit + reset | ✅ Keep | Por timezone do workspace |
| Send windows (jsonb) | ✅ Keep | Validation aplicada no worker |
| LGPD opt-in obrigatório (MARKETING) | ✅ Keep | Bloqueio pré-ativação |
| Opt-in método + source | ✅ Keep | Schema mantém |
| Bulk opt-in via fonte | ✅ Keep | Endpoint mantém |
| Opt-out automático por keyword | ✅ Keep | STOP/PARAR/SAIR/CANCELAR |
| Validação pré-voo (tier, quality, template, opt-in) | ✅ Keep | Excelente; replicar |
| Quality rating monitoring | ✅ Keep | Pausa em RED |
| Meta error codes handling (130472/131026/131047/131051) | ✅ Keep | Documentar runbook |
| Campaign metrics rolling | ✅ Keep | `campaign_metrics` snapshot |
| `health_status` (healthy/warning/critical) | ✅ Keep | UI mostra |
| AI handoff on reply | ✅ Keep | `auto_handoff_on_reply` + `ai_handoff_agent_id` |
| Custom segments | ⏸️ Defer | MVP só lista de contacts (futuro: segment table com filtros) |
| Campaign editor drawer (frontend) | 🔄 Rewrite | Refator com DS v2 + multi-step |
| CampaignsPanel | 🔄 Rewrite | DS v2 |
| DynamicWindowsEditor | ✅ Keep | UX bom |

---

## 7. Agendamentos (Calendar)

| Feature v1 | Status | Razão / Detalhe |
|---|---|---|
| Calendars table (personal/team/workspace) | ✅ Keep | Renamed types |
| Events table | ✅ Keep | Renamed columns; adiciona FK pra `contact`, `deal`, `conversation` |
| Availability rules | ✅ Keep | Refator schema |
| Availability exceptions | ✅ Keep | Refator schema |
| `compute_available_slots` PL/pgSQL | ✅ Keep | Replicar; adicionar buffer time entre eventos |
| Tool `list_calendars` | ✅ Keep | Mantém |
| Tool `get_available_slots` | ✅ Keep | Mantém |
| Tool `schedule_meeting` (rename `schedule_event`) | ✅ Keep | Mantém |
| Calendar permissions middleware | ✅ Keep | Refator |
| FullCalendar frontend | ✅ Keep | Manter biblioteca |
| Multi-day rules | ❓ Decidir | Suportar 24h+ rules? |
| Buffer time entre eventos | ✅ Add | **NOVO no v2**: 15min cleanup default |
| Google Calendar sync | ⏸️ Defer | Fase 2 |
| Outlook sync | ⏸️ Defer | Fase 2 |
| Meeting link auto-gen (Jitsi/Zoom) | ⏸️ Defer | Fase 2 |
| Event reminders | ✅ Keep | Notification system padrão |
| RSVP | ✅ Keep | event_participants.rsvp |

---

## 8. Contacts (CRM)

| Feature v1 | Status | Razão / Detalhe |
|---|---|---|
| Dual `customers` + `Contact` confusion | 🔄 Rewrite | Única tabela `contacts` |
| Tags | ✅ Keep | `tags` + `contact_tags` |
| Custom fields JSONB | ✅ Keep | Mantém |
| Owner | ✅ Keep | `owner_id` FK member |
| Notes | 🔄 Rewrite | Mover de string para nota anexa? Por enquanto string |
| ClienteForm | 🔄 Rewrite | DS v2 + RHF |
| ClienteDetailsModal | 🔄 Rewrite | DS v2 |
| ClienteTasksSection | 🔄 Rewrite | Substitui por sub-tasks de deal |
| ContactsCRM page | 🔄 Rewrite | DS v2 |
| LGPD soft delete | ✅ Keep | `deleted_at` mantém |
| LGPD direito ao esquecimento | ✅ Add | **NOVO no v2**: endpoint pra purge completo de PII |

---

## 9. Knowledge Base

| Feature v1 | Status | Razão / Detalhe |
|---|---|---|
| Full-text search PG (`search_knowledge_base` RPC) | 🔄 Rewrite | pgvector + fallback FTS |
| Chunking | ✅ Add | **NOVO**: semantic chunking |
| Embeddings | ✅ Add | **NOVO**: text-embedding-3-small |
| Categorization | ✅ Keep | Mantém |
| Tags + keywords | ✅ Keep | Mantém |
| Priority | ✅ Keep | Boost em ranking |
| Language | ✅ Keep | pt-BR default |
| Hierarchy (parent_id) | ⏸️ Defer | Útil? Deferred |
| Feedback (helpful/unhelpful) | ✅ Keep | Mantém |
| Visible to agents flag | ✅ Keep | Mantém |
| Approval workflow | ⏸️ Defer | Fase 2 |
| File upload (markdown/text) | ✅ Keep | Drag-drop UI |
| PDF parsing | ⏸️ Defer | Adicionar com pdf-parse fase 2 |
| URL ingest (scrape) | ⏸️ Defer | Fase 2 |

---

## 10. Departments & Teams

| Feature v1 | Status | Razão / Detalhe |
|---|---|---|
| Departments | ✅ Keep | Renamed columns |
| Teams | ✅ Keep | Renamed columns |
| Team schedules | ✅ Keep | JSONB no team |
| Department transfer tools (agente) | ✅ Keep | Tools `transfer_to_human`, `escalate_to_supervisor` |
| Department keywords | ✅ Keep | Auto-routing inbound |
| Auto-assign por team | ✅ Keep | Worker resolve |
| Department badge | ✅ Keep | UI |
| Department filter | ✅ Keep | UI |

---

## 11. Settings

| Feature v1 | Status | Razão / Detalhe |
|---|---|---|
| Settings layout (sub-routes) | ✅ Keep | Refator com DS v2 |
| Empresa (workspace) settings | ✅ Keep | Refator (`EmpresaPanel.refactored.example.tsx` like) |
| Perfil (member profile) | ✅ Keep | Refator |
| Canais (channels) | ✅ Keep | Refator + wizard de conexão Meta/WAHA |
| Chat settings | ✅ Keep | Refator |
| IA (agents) settings | ✅ Keep | Refator com playground integration |
| Base de conhecimento | ✅ Keep | Refator com chunking visualization |
| Colaboradores (members) | ✅ Keep | Refator com convite por email |
| Departamentos | ✅ Keep | Refator |
| Times | ✅ Keep | Refator |
| Calendar settings | ✅ Keep | Refator |
| Permissões | ✅ Keep | Refator com role matrix |
| Faturamento (billing) | ⏸️ Defer | Feature flag |
| Dev (API keys) | ✅ Keep | Refator |
| Notificações preferences | ✅ Keep | Refator |
| Automation rules | ❓ Decidir | Vamos ter automation rules separadas de Flow Builder? |
| Subscription panel | ⏸️ Defer | Feature flag |

---

## 12. Admin (platform-level)

| Feature v1 | Status | Razão / Detalhe |
|---|---|---|
| Admin layout + sidebar | ✅ Keep | Refator com DS v2 escuro intenso |
| Admin dashboard (KPIs gerais) | ✅ Keep | Refator |
| Companies list (workspaces) | ✅ Keep | Renomeada |
| Company details com tabs | ✅ Keep | Refator |
| Company sub-views: Overview, Inboxes, Agents, Users, Usage, Billing, Logs, Subscription | ✅ Keep | Renamed para channels, members |
| Infrastructure dashboard | ✅ Keep | Refator com gráficos Recharts |
| - Database tab (sizes, connections) | ✅ Keep | |
| - Redis tab (hit rate, memory) | ✅ Keep | |
| - RabbitMQ tab (queue lengths) | ✅ Keep | |
| - Workers tab (heartbeats) | ✅ Keep | |
| - Overview tab | ✅ Keep | |
| Templates admin (agente) + Editor + Tester | ✅ Keep | Refator |
| Tools admin + monitoring | ✅ Keep | Refator |
| Project templates admin | ❓ Decidir | Se Projects entrar no MVP |
| Audit logs viewer | ✅ Keep | UI nova com filtros |

---

## 13. Dashboards & analytics

| Feature v1 | Status | Razão / Detalhe |
|---|---|---|
| Dashboard overview | ✅ Keep | Refator com DS v2 |
| KPI cards | ✅ Keep | Refator (Stat component) |
| AlertsPanel | ✅ Keep | Refator |
| Charts (Recharts) | ✅ Keep | Mantém library |
| Message volume chart | ✅ Keep | |
| Response time chart | ✅ Keep | |
| Top customers | ✅ Keep | |
| Funnel data | ✅ Keep | Pipeline-based |
| Campaign stats | ✅ Keep | |
| Inbox stats | ✅ Keep | Renamed channel stats |
| Agent metrics | ✅ Keep | |
| Lead stats | 🔄 Rewrite | Deal stats |
| Recent chats | ✅ Keep | Renamed recent conversations |
| Agent monitoring (detailed) | ✅ Keep | |
| dashboard-aten (atendimento) | 🔄 Rewrite | Mais limpo |
| dashboard-orca (orçamento) | ❌ Discard | Era vertical solar |

---

## 14. Tasks (módulo dedicado)

❌ **Descartado por completo do v2** (decisão PRD §3.3 #1). Sem módulo, sem `deal_tasks`, sem badges, sem nada. Se voltar à pauta, é módulo novo desenhado do zero, não bolt-on.

| Feature v1 | Status |
|---|---|
| Tasks page (lista) | ❌ Discard |
| Task CRUD | ❌ Discard |
| Task assignment | ❌ Discard |
| Task deadlines + reminders | ❌ Discard |
| TaskCreate em chat | ❌ Discard |
| LeadTaskBadge | ❌ Discard |

---

## 15. Documents / Templates / Orçamentos

❌ **Descartado no v2 como estava no v1** (DOCX templating + docxtemplater). Decisão PRD §3.3 #3: geração de documento será reabordada em fase futura com **estratégia diferente** — provavelmente LLM-driven (gerar texto contextual com agente, exportar PDF) em vez de templating estrutural. Nada disso no v2.

| Feature v1 | Status |
|---|---|
| Document templates system | ❌ Discard (será refeito) |
| Docxtemplater integration | ❌ Discard |
| Proposal generation (DOCX) | ❌ Discard |
| Proposal/Financing (vertical solar) | ❌ Discard |
| Template variables editor | ❌ Discard |
| Document conversion (DOCX) | ❌ Discard |

---

## 16. Produtos / Galeria / Catalog

❌ **Tudo descartado do MVP** (decisão PRD §3.3 #6). Não-alinhado com os nichos-alvo do v2 (digital marketing, escritórios, imobiliárias, clínicas, advocacias) — são negócios de serviço, não de produto físico.

| Feature v1 | Status |
|---|---|
| Produtos CRUD | ❌ Discard |
| Galeria | ❌ Discard |
| Catalog (`catalog-config.ts`) | ❌ Discard |
| Industry config v1 (solar/construção hardcoded) | ❌ Discard como estava |
| **Industry-awareness v2** | ✅ Reframe | Agora vive em `workspaces.industry` + `agent_templates.industry` + `pipelines.industry`, com cinco nichos canônicos: `digital_marketing`, `office_services`, `real_estate`, `clinic`, `law_firm` (PRD §3.3 #4) |
| MediaCard (galeria de produtos) | ❌ Discard |

---

## 17. Notifications

| Feature v1 | Status | Razão / Detalhe |
|---|---|---|
| `notifications` table | ✅ Keep | Schema simples |
| Notification dropdown UI | ✅ Keep | Refator DS v2 |
| Notification preferences (granulares) | ❌ Discard MVP | Decisão PRD §3.3 #7 — só padrão global no MVP; granularidade entra em fase posterior se demanda aparecer |
| Tipos: mention, assignment, campaign_done, deal_closed, etc | ✅ Keep | Lista expansível |
| Mark as read | ✅ Keep | |
| Cleanup cron (>30d lidas) | ✅ Keep | |

---

## 18. API pública

| Feature v1 | Status | Razão / Detalhe |
|---|---|---|
| `/api/v1/*` namespace | ✅ Keep | Mantém |
| Rate limit por API key | ✅ Keep | Refator com Redis store |
| Endpoint send_message | ✅ Keep | |
| Endpoint send_template | ✅ Keep | |
| Endpoint upsert_contact | ✅ Keep | |
| Endpoint trigger_flow | ✅ Keep | |
| Endpoint list_conversations | ✅ Keep | |
| Endpoint get_conversation | ✅ Keep | |
| Webhook subscription | ✅ Keep | `outbound_webhooks` table |
| HMAC signature em webhook outbound | ✅ Add | **NOVO no v2** (v1 sem signature) |
| OpenAPI spec auto-gen | ✅ Add | **NOVO**: docs API derivada de Zod schemas |

---

## 19. Cadastro / Onboarding

| Feature v1 | Status | Razão / Detalhe |
|---|---|---|
| Cadastro como app Vite separado (v1) | ❌ Discard | No v2 não tem app separado; quando Cadastro entrar (fase 2), é rota em `app/(public)/cadastro/` no mesmo Next.js |
| useCadastro hook | ⏸️ Defer | Fase 2 |
| OnboardingModal | ⏸️ Defer | Fase 2 |
| FirstInboxWizard | ✅ Keep | Importante no MVP; embute no app principal pós-signup |
| Solar data extractor | ❌ Discard | Vertical-specific |

---

## 20. Landing page

| Feature v1 | Status | Razão / Detalhe |
|---|---|---|
| Landing como app Vite separado (v1) | ❌ Discard como estava | Quando entrar (fase 2), é rota em `app/(public)/` no mesmo Next.js — mesmo deploy, mesmo container `web` |
| Páginas institucionais | ⏸️ Defer | |
| Legal (LGPD, Privacy, Terms) | ⏸️ Defer | |
| Hero/Features/Pricing | ⏸️ Defer | |

---

## 21a. Instagram (Meta) — domínio novo no v2

Doc dedicado: [`features/INSTAGRAM.md`](./features/INSTAGRAM.md). Resumo:

| Feature | Status | Razão / Detalhe |
|---|---|---|
| Provider `meta_instagram` no `channels` | ✅ Add (MVP) | Schema, naming, CHECK constraint multi-provider prontos |
| Webhook único `/webhooks/meta` (WA + IG) | ✅ Add (MVP) | Despacho por `body.object`; mesmo Meta App como Tech Provider único |
| `IChannelAdapter` com union `meta_whatsapp \| meta_instagram \| waha` | ✅ Add (MVP) | Interface comum; impl IG fica F1.5 |
| Embedded Signup unificado (FB Login + scopes IG + WA) | 🔄 Rewrite (F1.5) | Wizard de conexão de canal cobre os 3 providers |
| Parser webhook Instagram (`entry.messaging[]` + `entry.changes[]`) | ✅ Add (F1.5) | DMs + postbacks + reactions + stories + comments |
| Send DM (text + media) | ✅ Add (F1.5) | `POST /<ig_user_id>/messages` |
| Send interactive (quick_replies, generic_template, button_template) | ✅ Add (F1.5) | Discriminated union estendida em `packages/shared/types/interactive.ts` |
| Story mention inbound + download | ✅ Add (F1.5) | `type='story_mention'`; URL expira ~5min; download imediato R2 |
| Story reply inbound | ✅ Add (F1.5) | `type='story_reply'`; permanece em `kind='direct'` |
| Comments em post/reel | ✅ Add (F1.5) | Tabela `ig_comments` + `conversations.kind='comment_thread'` |
| Comment public reply | ✅ Add (F1.5) | `POST /<comment_id>/replies` |
| Comment private reply (comment-to-DM) | ✅ Add (F1.5) | `POST /<ig_user_id>/messages { recipient: { comment_id } }`; cria conversation kind='direct' |
| Hide / delete comment | ✅ Add (F1.5) | Workflow tool com `requires_human_approval` default ON |
| Janela 24h + HUMAN_AGENT tag (até 7d) | ✅ Add (F1.5) | Composer state `'human_agent_tag'`; audit log obrigatório |
| Auto-moderação ML de comments | ⏸️ Defer | Fase 2 |
| Click-to-Instagram-DM ads (referral parsing avançado) | ⏸️ Defer | Schema persiste referral no MVP; UI de atribuição F2 |
| Instagram Threads (app separado) | ❌ Discard | Fora do escopo Highermind v2 |
| Multi-account IG por workspace na UI | ⏸️ Defer | Schema permite (várias `channels` rows); UI selector F2 |
| Tools IA específicas (`reply_to_comment`, `private_reply_to_comment`, `hide_comment`) | ✅ Add (F1.5) | Categoria `workflow`; algumas com aprovação humana default |

---

## 21b. Super-admin de IA (controle de plataforma)

Novo domínio inteiro no v2.

| Feature | Status | Detalhe |
|---|---|---|
| Tabela `workspace_agent_policies` | ✅ Add (MVP) | Per-workspace: allowed_models[], allow_streaming/interrupts/vision/transcription, max_iterations, max_monthly_cost_usd, allowed_tool_categories[] |
| Tabela `llm_models_whitelist` | ✅ Add (MVP) | Catálogo global de modelos OpenRouter; super-admin marca quais entram no produto |
| Tabela `platform_secrets` | ✅ Add (MVP) | `openrouter_api_key`, `meta_app_secret`, `meta_app_id`, `meta_webhook_verify_token`, `openai_api_key`, versionados para rotação |
| Endpoint `PATCH /platform/workspaces/:id/agent-policy` | ✅ Add (MVP) | Restrito a `is_platform_admin=true` |
| Endpoint `POST /platform/llm-models/sync` | ✅ Add (MVP) | Sincroniza catálogo com OpenRouter `/api/v1/models` |
| Painel super-admin: edição de policy por workspace | ✅ Add (MVP) | UI em `apps/web/src/features/platform-admin/AgentPoliciesPage.tsx` |
| Painel super-admin: catálogo de modelos | ✅ Add (MVP) | UI: ativar/desativar modelos por plano |
| Painel super-admin: gastos por workspace (mês corrente, top spenders) | ✅ Add (MVP) | Roll-up de `llm_usage_logs` |
| Hard cap pré-call enforcement | ✅ Add (MVP) | Antes de chamar agent-runtime, Node verifica `policy.max_monthly_cost_usd - llm_usage_logs.sum_cost > custo_estimado_chamada`; bloqueia se excede |
| Rotação de OpenRouter API key | ✅ Add (MVP) | Runbook `docs/runbooks/rotate-openrouter-key.md` |

---

## 21c. Adaptação por nicho (vertical-aware) — domínio novo no v2

Decisão PRD §3.3 #4. Nichos-alvo: **mercado digital, escritórios, imobiliárias, clínicas, advocacias**.

| Feature | Status | Detalhe |
|---|---|---|
| `workspaces.industry` com valores canônicos | ✅ Add (MVP) | `digital_marketing` \| `office_services` \| `real_estate` \| `clinic` \| `law_firm` (free text aceito; UI sugere os 5) |
| Onboarding pergunta nicho | ✅ Add (MVP) | Primeira tela pós-signup; alimenta seed de templates |
| Catálogo global de `agent_templates` por nicho | ✅ Add (MVP entrega 1–2 nichos, expansão pós-MVP) | Variantes dos 5 templates base (sales, reception, support, first_touch, follow_up) por nicho |
| Catálogo global de `pipelines` + `stages` por nicho | ✅ Add (MVP entrega 1–2 nichos) | Templates iniciais: imobiliária (lead→visita→proposta→contrato→escritura), advocacia (lead→diagnóstico→contrato→processo→encerramento), clínica (lead→agendamento→consulta→tratamento→alta), digital (lead→diagnóstico→proposta→onboarding→execução→retainer), escritório (lead→diagnóstico→proposta→contrato→execução) |
| Wizard "criar workspace a partir de template de nicho" | ✅ Add (MVP) | Em 1 clique cria pipeline default + 1–2 agentes default do nicho |
| Glossário/terminologia adaptada por nicho | ⏸️ Defer | "Deal" vs "Cliente" vs "Processo" vs "Paciente" — UI usa "Deal" universal no MVP; ajustes futuros |
| Tools agente nicho-specific | ⏸️ Defer | Ex: `book_consultation` (clínica), `register_property_visit` (imobiliária). Tools genéricas cobrem MVP |
| Knowledge base seed por nicho | ⏸️ Defer | Conteúdo educativo inicial por vertical |

Decisão de qual nicho entra primeiro: provavelmente **imobiliária + clínica** (mais demanda imediata pela rede do Rogério).

---

## 21. Features órfãs do v1 (não migrar)

- `check_view.ts`, `check_constraints.ts`, `fix_schema.ts` em `backend/src/` — não pertenciam ao código de produção
- `pages/admin.tsx` placeholder vazio
- `pages/AutomationRulesPage.tsx` duplicada
- `pages/calendar.tsx`, `pages/clientes.tsx` rotas legadas
- `EmpresaPanel.refactored.example.tsx` (exemplo de refator, conceito virou padrão DS v2)
- ToastContainer duplicado
- `lib/design-system.ts` (220 linhas legacy)
- `form-utils.ts` (`useFormValidation` manual)
- `pages/funil/types.ts` (substituído pelo schema novo)

---

## 22. Items resolvidos (revisão Rogério)

Itens 1-7 fechados em PRD §3.3 — repassando:

1. **Tasks como módulo ou sub-task?** → ❌ **Descartado por completo** (nem módulo, nem `deal_tasks`).
2. **Projects templates por indústria?** → ❌ Descartado. Conceito de adaptação por nicho sobrevive em `agent_templates.industry` + `pipelines.industry`.
3. **Document templates DOCX?** → ❌ Descartado; será refeito futuramente com outra estratégia (LLM-driven).
4. **Industry config / catalog config?** → ❌ Descartado como estava (solar/construção). ✅ **Reframe:** nichos-alvo do v2 são digital marketing, escritórios, imobiliárias, clínicas, advocacias.
5. **Mentions em mensagens normais?** → ❌ Não. Mantém só em notas internas.
6. **Galeria de produtos?** → ❌ Descartada do MVP.
7. **Notification preferences granulares?** → ❌ Não no MVP. Só padrão global.

Items 8–10 (recomendações padrão; sem objeção do Rogério, mantém):

8. **KB hierarchy (parent_id)?** → drop; só category.
9. **Multi-day availability rules?** → drop; só per-day rules + exceptions.
10. **Automation rules separadas de Flow Builder?** → drop; Flow Builder cobre.

---

## 23. Score de prioridade no MVP (estimativa esforço)

| Domínio | % do MVP | Esforço relativo |
|---|---|---|
| Auth + Workspace + Members | 4% | 1 semana |
| Channels (Meta WA + IG schema + WAHA + webhook unificado) | 6% | 1.5 semanas |
| LiveChat (inbound + outbound + UI) | 22% | 5 semanas |
| Agent runtime Python (LangGraph + LangServe + OpenRouter integration) | 6% | 1.5 semanas |
| Agentes IA (templates + tools + KB + cost tracking) | 16% | 3.5 semanas |
| Super-admin de IA (policies + whitelist + secrets + painéis) | 4% | 1 semana |
| Flow Builder (engine + UI + 14 handlers) | 14% | 3 semanas |
| Pipeline (deals + stages + automation, sem tasks) | 8% | 1.5 semanas |
| Campanhas | 7% | 1.5 semanas |
| Calendar + tools agente | 4% | 1 semana |
| Contacts CRM | 3% | 0.5 semana |
| Dashboard + admin geral | 4% | 1 semana |
| Seed nicho (templates pipeline + agentes para imobiliária e clínica) | 2% | 0.5 semana |
| Implementação completa Instagram (F1.5, pós-MVP) | 1% | 2 semanas dedicadas |

**Total MVP:** ~22 semanas / 5–5.5 meses de trabalho focado. Pode ser muito menos com IA gerando código.

---

> Mudanças aqui exigem update no PRD + ROADMAP. Documento muda quando Rogério revisa items §22.
