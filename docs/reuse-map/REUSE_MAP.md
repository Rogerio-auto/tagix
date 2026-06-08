# REUSE_MAP — Mapa arquivo-por-arquivo v1 → v2

> **Documento:** Mapeamento direto dos arquivos do legado para seu destino no v2 (ou "discard")
> **Versão:** 0.1 — 2026-06-06
> **Uso:** Antes de portar qualquer código do v1, conferir aqui. Se está como ❌, não portar.

---

## Convenções

| Símbolo | Ação |
|---|---|
| ✅ Port direto | Copia + ajusta imports + renomeia (workspace_id, etc) |
| 🔄 Reescrever | Conceito mantém; código não. Olhar v1 como referência apenas |
| ❌ Descartar | Não migra |
| 🆕 Novo | Não existia no v1 |

---

## 1. Backend root

| v1 (`backend/src/`) | v2 destino | Status |
|---|---|---|
| `index.ts` | `apps/api/src/index.ts` | 🔄 (composition limpa) |
| `worker.ts` (3500 linhas monolítico) | `apps/workers/src/{inbound,outbound,media,campaigns,flows}/index.ts` (split) | 🔄 |
| `worker.campaigns.ts` | `apps/workers/src/campaigns/index.ts` | 🔄 |
| `worker.flows.ts` | `apps/workers/src/flows/index.ts` | 🔄 |
| `pg.ts` (pool com retry) | `packages/db/src/connection.ts` | 🔄 (usar `postgres` driver, não `pg`) |
| `check_view.ts`, `check_constraints.ts`, `fix_schema.ts`, `run-migration.ts` | — | ❌ (scripts ad-hoc, não pertencem ao código de produção) |

---

## 2. Backend `lib/`

| v1 | v2 | Status |
|---|---|---|
| `lib/crypto.ts` | `packages/shared/src/crypto/secret.ts` | ✅ (com versionamento de key) |
| `lib/redis.ts` | `packages/db/src/cache/redis.ts` | 🔄 (key builders novos) |
| `lib/distributedLock.ts` | `packages/shared/src/locks/distributed.ts` | ✅ |
| `lib/singleInstance.ts` | `packages/shared/src/locks/singleton.ts` | ✅ |
| `lib/cache.ts` | `packages/db/src/cache/single-flight.ts` | ✅ |
| `lib/io.ts` (socket setup) | `apps/api/src/socket/index.ts` | 🔄 |
| `lib/stripe.ts` | `apps/api/src/billing/stripe.ts` | 🔄 (atrás de feature flag) |
| `lib/supabase.ts` | `apps/api/src/auth/supabase-adapter.ts` (atrás de IAuthProvider) | 🔄 |
| `lib/storage.ts` (Supabase Storage) | `packages/storage/src/r2-driver.ts` + `local-driver.ts` | 🔄 (driver pattern) |
| `lib/mediaProxy.ts` | — | ❌ (substituído por signed URLs R2 diretas) |
| `lib/logger.ts` | `packages/logger/src/index.ts` | 🔄 (usar Pino) |
| `lib/pii-mask.util.ts` | `packages/logger/src/pii-mask.ts` | ✅ |
| `lib/api-response.ts` | `apps/api/src/lib/response.ts` | 🔄 |

---

## 3. Backend `services/`

| v1 | v2 | Status |
|---|---|---|
| `services/agents-runtime.service.ts` (702 linhas) | `packages/agents/src/graph.ts` + nodes em `packages/agents/src/nodes/` | 🔄 (LangGraph rewrite) |
| `services/agent-context.service.ts` | — | ❌ (PostgresCheckpointer substitui Redis context) |
| `services/agent-templates.service.ts` | `apps/api/src/services/agent-templates.service.ts` | ✅ (CRUD refator) |
| `services/tool-handlers.service.ts` | `packages/agents/src/tools/*` (modular por categoria) | 🔄 |
| `services/tokens.service.ts` | `packages/agents/src/pricing.ts` (estática) + cost service | 🔄 |
| `services/openai-usage.service.ts` | `packages/agents/src/usage.ts` | ✅ |
| `services/agent-metrics.repository.ts` | `apps/api/src/services/agent-metrics.service.ts` | 🔄 |
| `services/flow-engine.service.ts` (628 linhas) | `packages/flow-engine/src/engine.ts` (split em runStep, dispatch, resume, cancel) | 🔄 |
| `services/flow-engine/registry.ts` | `packages/flow-engine/src/registry.ts` | ✅ (com types discriminadas) |
| `services/flow-engine/types.ts` | `packages/flow-engine/src/types.ts` | 🔄 (tipos strict) |
| `services/flow-engine/handlers/*.handler.ts` (14 arquivos) | `packages/flow-engine/src/handlers/*.handler.ts` | ✅ (port com Zod schemas tipados) |
| `services/flow-engine/utils/interpolate.ts` | `packages/flow-engine/src/utils/interpolate.ts` | ✅ |
| `services/flow-engine/utils/pre-action.ts` | `packages/flow-engine/src/utils/pre-action.ts` | ✅ |
| `services/flow-engine/utils/send-outbound.ts` (300 linhas) | `packages/flow-engine/src/utils/send-outbound.ts` | 🔄 (split + tested) |
| `services/customers/opt-in.service.ts` | `apps/api/src/services/opt-in.service.ts` | 🔄 |
| `services/meta/handlers.service.ts` | `packages/channels/src/meta/webhook.ts` + `parser.ts` | 🔄 |
| `services/meta/store.service.ts` (1000+ linhas) | `packages/db/src/repos/conversations.repo.ts` + `messages.repo.ts` + cache | 🔄 (split em modules) |
| `services/meta/inbox-cache.test.ts` | port to v2 tests | ✅ |
| `services/meta/flows.test.ts` | port | ✅ |
| `services/waha/client.service.ts` | `packages/channels/src/waha/client.ts` | 🔄 |
| `services/subscriptions.service.ts` | `apps/api/src/billing/subscriptions.service.ts` (atrás de feature flag) | 🔄 |
| `services/notification-triggers.service.ts` | `apps/api/src/services/notifications.service.ts` | 🔄 |
| `services/admin/companyBilling.service.ts` | `apps/api/src/admin/workspace-billing.service.ts` (renomeado) | 🔄 |
| `services/webhook.service.ts` | `apps/api/src/services/outbound-webhooks.service.ts` | 🔄 (com HMAC signature) |

---

## 4. Backend `repos/`

| v1 | v2 | Status |
|---|---|---|
| `repos/agents.repo.ts` | `packages/db/src/repos/agents.repo.ts` | 🔄 (Drizzle queries) |
| `repos/agent-templates.repo.ts` | `packages/db/src/repos/agent-templates.repo.ts` | 🔄 |
| `repos/tools.repo.ts` | `packages/db/src/repos/tools.repo.ts` | 🔄 |
| `repos/knowledge.repo.ts` | `packages/db/src/repos/knowledge-base.repo.ts` | 🔄 |
| `repos/chat-messages.repo.ts` | `packages/db/src/repos/messages.repo.ts` | 🔄 |
| `repos/tasks.repo.ts` | `packages/db/src/repos/deal-tasks.repo.ts` (sub-tasks de deal) | 🔄 |
| `repos/projects.repo.ts` | `packages/db/src/repos/pipelines.repo.ts` + `deals.repo.ts` | 🔄 (unified) |
| `repos/flows.repo.ts` | `packages/db/src/repos/flows.repo.ts` | 🔄 |

---

## 5. Backend `routes/`

Cada router em v1 → renomear + refatorar:

| v1 | v2 | Status |
|---|---|---|
| `routes/livechat.*.ts` | `apps/api/src/routes/conversations/*.ts` | 🔄 (renamed domain) |
| `routes/agents.ts` | `apps/api/src/routes/agents/*.ts` | 🔄 |
| `routes/flows.ts` + `livechat.flows.ts` | `apps/api/src/routes/flows/*.ts` | 🔄 |
| `routes/livechat.flow-executions.ts` | `apps/api/src/routes/flow-executions.ts` | 🔄 |
| `routes/calendar.ts` | `apps/api/src/routes/calendar.ts` | 🔄 |
| `routes/kanban.ts` | `apps/api/src/routes/pipeline/*.ts` | 🔄 |
| `routes/campaigns.*.ts` | `apps/api/src/routes/campaigns/*.ts` | 🔄 |
| `routes/admin/*.ts` | `apps/api/src/routes/admin/*.ts` | 🔄 |
| `routes/api.v1.ts` | `apps/api/src/routes/public/v1.ts` | 🔄 (OpenAPI spec gen) |
| `routes/metawebhook.ts` | `apps/api/src/routes/webhooks/meta.ts` | 🔄 |
| `routes/devTest.ts` | — | ❌ |
| `routes/settings.inboxes.delete.test.ts` | port | ✅ |
| `routes/livechat.auto-assign.test.ts` | port | ✅ |

---

## 6. Backend `middlewares/`

| v1 | v2 | Status |
|---|---|---|
| `middlewares/requireAuth.ts` | `apps/api/src/middlewares/requireAuth.ts` | 🔄 (interface IAuthProvider) |
| `middlewares/requireApiKey.ts` | `apps/api/src/middlewares/requireApiKey.ts` | ✅ |
| `middlewares/requireActiveSubscription.ts` | `apps/api/src/middlewares/requireActiveSubscription.ts` | 🔄 (feature flag) |
| `middlewares/checkSubscription.ts` | merge no acima | 🔄 |
| `middlewares/calendarPermissions.ts` | `apps/api/src/middlewares/requireCalendarAccess.ts` | 🔄 |
| `middlewares/api-v1-limits.ts` | `apps/api/src/middlewares/rateLimit.ts` | 🔄 |

---

## 7. Backend `controllers/`

V1 mistura controllers + routes inconsistente. No v2, eliminar pasta `controllers/` — routes têm handlers diretos (ou chamam services).

| v1 controllers | v2 | Status |
|---|---|---|
| `controllers/admin/*.controller.ts` | merge em `apps/api/src/routes/admin/*.ts` | 🔄 |
| `controllers/company.controller.ts` | `apps/api/src/routes/workspace.ts` (renamed) | 🔄 |
| `controllers/document.controller.ts` | — | ❌ (documents fora MVP) |
| `controllers/livechat.controller.ts` | merge em routes/conversations | 🔄 |
| `controllers/proposal.controller.ts` | — | ❌ |
| `controllers/queue.controller.ts` | `apps/api/src/routes/admin/queues.ts` | 🔄 |
| `controllers/system.controller.ts` | `apps/api/src/routes/admin/system.ts` | 🔄 |

---

## 8. Backend `jobs/` (scheduler)

| v1 | v2 | Status |
|---|---|---|
| `jobs/scheduler.ts` | `apps/workers/src/scheduler/index.ts` | 🔄 |
| `jobs/autoAgentFollowup.ts` | `apps/workers/src/scheduler/jobs/agent-followup.job.ts` | 🔄 (idempotente) |
| `jobs/sync-openai-usage.job.ts` | `apps/workers/src/scheduler/jobs/openai-usage-sync.job.ts` | 🔄 |
| `jobs/check-project-deadlines.job.ts` | `apps/workers/src/scheduler/jobs/deal-deadlines.job.ts` (renamed) | 🔄 |
| `jobs/check-general-tasks.job.ts` | `apps/workers/src/scheduler/jobs/task-reminders.job.ts` | 🔄 |
| `jobs/taskReminders.ts` | merge no acima | 🔄 |
| `jobs/startChat.ts` | — | ❌ (não usado/seedo) |

---

## 9. Backend `worker/outbound/` (composition)

**Excelente decomposição do v1; replicar como-é.**

| v1 | v2 | Status |
|---|---|---|
| `worker/outbound/runOutboundJob.ts` | `apps/workers/src/outbound/run.ts` | ✅ |
| `worker/outbound/processOutboundJob.ts` | `apps/workers/src/outbound/process.ts` | ✅ |
| `worker/outbound/dispatchOutboundJob.ts` | `apps/workers/src/outbound/dispatch.ts` | ✅ |
| `worker/outbound/parseOutboundQueueMessage.ts` | `apps/workers/src/outbound/parse.ts` | ✅ |
| `worker/outbound/handleMetaSendTextJob.ts` | `apps/workers/src/outbound/handlers/meta-text.ts` | ✅ |
| `worker/outbound/handleMetaSendMediaJob.ts` | `apps/workers/src/outbound/handlers/meta-media.ts` | ✅ |
| `worker/outbound/handleMetaSendTemplateJob.ts` | `apps/workers/src/outbound/handlers/meta-template.ts` | ✅ |
| `worker/outbound/prepareMetaMediaForSend.ts` | `apps/workers/src/outbound/handlers/meta-media-prepare.ts` | ✅ |
| `worker/outbound/sendMetaMediaAndPersist.ts` | merge no acima | 🔄 |
| `worker/outbound/finalizeMetaMediaSend.ts` | `apps/workers/src/outbound/finalize.ts` | 🔄 (genérico, não Meta-only) |
| `worker/outbound/updateCampaignDeliveryForText.ts` | `apps/workers/src/outbound/post/update-campaign-delivery.ts` | ✅ |
| `worker/outbound/updateCampaignDeliveryForMedia.ts` | merge no acima | 🔄 |
| `worker/outbound/handleMetaTextPostSendSideEffects.ts` | `apps/workers/src/outbound/post/side-effects.ts` | ✅ |
| `worker/outbound/handleMetaMediaSocketSideEffects.ts` | merge no acima | 🔄 |
| `worker/outbound/handleOutboundJobFailure.ts` | `apps/workers/src/outbound/failure.ts` | ✅ |
| `worker/runtime/startJsonWorker.ts` | `packages/shared/src/queue/start-consumer.ts` | ✅ |

---

## 10. Backend `queue/`

| v1 | v2 | Status |
|---|---|---|
| `queue/rabbit.ts` (54-123 topology) | `packages/shared/src/queue/topology.ts` + `publish.ts` + `consume.ts` | 🔄 (mesma topologia, renamed `hm.*`) |

---

## 11. Backend `schemas/`

| v1 | v2 | Status |
|---|---|---|
| `schemas/campaign.schema.ts` | `packages/shared/src/schemas/campaign.schema.ts` | 🔄 |
| `schemas/chat.schema.ts` | `packages/shared/src/schemas/conversation.schema.ts` | 🔄 (renamed) |
| `schemas/contact.schema.ts` | `packages/shared/src/schemas/contact.schema.ts` | 🔄 |
| `schemas/api.v1.schema.ts` | `apps/api/src/routes/public/v1/schemas.ts` | 🔄 |

---

## 12. Backend `types/`

| v1 | v2 | Status |
|---|---|---|
| `types/index.ts` | `packages/shared/src/types/index.ts` | 🔄 (refator) |
| `types/integrations.types.ts` | `packages/shared/src/types/channel.types.ts` | 🔄 |

---

## 13. Backend `seeds/`

| v1 | v2 | Status |
|---|---|---|
| `seeds/project-templates.seed.ts` | `packages/db/src/seeds/pipeline-templates.seed.ts` | 🔄 (se Rogério decidir manter pipeline templates) |

---

## 14. Backend tests

| v1 padrão | v2 |
|---|---|
| `*.test.ts` em `src/` | `*.test.ts` em mesmo lugar (próximo do código testado) ou `__tests__/` |
| `__tests__/integration/health.test.ts` | port | ✅ |
| `__tests__/integration/api_v1.test.ts` | port + expand | 🔄 |
| `services/flow-engine/__tests__/fixtures/ctx.fixture.ts` | port | ✅ |
| Vitest config | `packages/<each>/vitest.config.ts` + root config | 🔄 |

---

## 15. packages/shared (v1)

| v1 `packages/shared/src/` | v2 | Status |
|---|---|---|
| `types/message.types.ts` | `packages/shared/src/types/message.types.ts` | 🔄 (interactive_payload discriminated) |
| `types/inbox.types.ts` | `packages/shared/src/types/channel.types.ts` | 🔄 (renamed) |
| `types/integration.types.ts` | merge channel.types | 🔄 |
| `types/agent.types.ts` | `packages/shared/src/types/agent.types.ts` | 🔄 |
| `types/flow.types.ts` | `packages/shared/src/types/flow.types.ts` | 🔄 |
| `types/user.types.ts` | `packages/shared/src/types/member.types.ts` (renamed) | 🔄 |
| `types/notification.types.ts` | port | ✅ |
| `types/calendar.types.ts` | port | ✅ |
| `types/chat.types.ts` | `packages/shared/src/types/conversation.types.ts` | 🔄 (renamed) |
| `types/company.types.ts` | `packages/shared/src/types/workspace.types.ts` | 🔄 (renamed) |
| `types/customer.types.ts` | `packages/shared/src/types/contact.types.ts` (renamed) | 🔄 |
| `types/document.types.ts` | — | ❌ |
| `types/knowledge.types.ts` | `packages/shared/src/types/knowledge.types.ts` | 🔄 |
| `types/lead.types.ts` | — | ❌ (substituído por deal + contact) |
| `types/project.types.ts` | `packages/shared/src/types/pipeline.types.ts` (renamed; conceito muda) | 🔄 |
| `types/proposal.types.ts` | — | ❌ |
| `types/task.types.ts` | `packages/shared/src/types/deal-task.types.ts` | 🔄 |
| `types/tool.types.ts` | `packages/shared/src/types/tool.types.ts` | 🔄 |
| `types/campaign.types.ts` | port + expand | 🔄 |
| `types/automation-rules.types.ts` | — | ❌ (Flow Builder cobre; "automation rules" como conceito separado descartado) |
| `types/cadastro.types.ts` | — | ❌ (fase 2) |
| `types/dashboard.types.ts` | port | 🔄 |
| `types/product.types.ts` | — | ❌ |
| `types/admin-panel.types.ts` | `packages/shared/src/types/admin.types.ts` | 🔄 |
| `validators/user.validators.ts` | `packages/shared/src/schemas/member.schema.ts` | 🔄 |
| `validators/project.validators.ts` | `packages/shared/src/schemas/pipeline.schema.ts` | 🔄 |
| `validators/index.ts` | port | 🔄 |
| `utils/index.ts` | `packages/shared/src/utils/` | 🔄 |

---

## 16. Frontend (apps/web)

### 16.1 Root

| v1 `frontend/src/` | v2 (Next.js 15 App Router em `apps/web/`) | Status |
|---|---|---|
| `App.tsx` (310 linhas) | dissolvido em `app/layout.tsx` (root providers) + `app/(app)/layout.tsx` (AppLayout) + Server Components por página | 🔄 |
| `main.tsx` | n/a — Next.js gerencia ponto de entrada via `app/layout.tsx` | ❌ Discard |
| `style.css` (440 linhas, dois sistemas) | `apps/web/app/globals.css` (tokens v2 only) | 🔄 |
| `vite.config.ts` | `apps/web/next.config.mjs` (output: 'standalone', images.remotePatterns p/ R2) | 🔄 |
| `vite-env.d.ts` | `apps/web/next-env.d.ts` (gerado pelo Next) | ❌ Discard manual |

### 16.2 Context

| v1 | v2 | Status |
|---|---|---|
| `context/AuthContext.tsx` | `apps/web/src/core/auth/auth.store.ts` (Zustand) + AuthProvider mínimo | 🔄 |
| `context/ThemeContext.tsx` (290 linhas) | `apps/web/src/core/theme/theme.store.ts` + provider | 🔄 |
| `context/SubscriptionContext.tsx` | `apps/web/src/core/subscription/subscription.store.ts` | 🔄 |
| `context/CadastroContext.tsx` | — | ❌ (fase 2) |
| `context/SocketContext.tsx` | `apps/web/src/core/socket/SocketProvider.tsx` | 🔄 |

### 16.3 Hooks

| v1 | v2 | Status |
|---|---|---|
| `hooks/useDashboard.ts` (208 linhas) | `apps/web/src/features/dashboard/queries.ts` (split) | 🔄 |
| `hooks/useAgentConfig.ts` | `apps/web/src/features/agents/queries.ts` | 🔄 |
| `hooks/useAgentMetrics.ts` | merge no acima | 🔄 |
| `hooks/useAgentWebSocket.ts` | — | ❌ (era TODO; substituído por SSE de LangGraph) |
| `hooks/useFlowExecutions.ts` | `apps/web/src/features/flow-builder/queries.ts` | 🔄 |
| `hooks/useManualFlows.ts` (não confirmado em explorer mas inferido FX-029b) | port | 🔄 |
| `hooks/useLivechatChatsData.ts` | `apps/web/src/features/conversations/queries.ts` | 🔄 |
| `hooks/useLivechatMessagesData.ts` | merge no acima | 🔄 |
| `hooks/useLivechatSocket.ts` | `apps/web/src/features/conversations/hooks/useConversationSocket.ts` | 🔄 |
| `hooks/useLivechatNotification.ts` | `apps/web/src/features/conversations/hooks/useConversationNotifications.ts` | 🔄 |
| `hooks/useCalendarPermissionsSettings.ts` | `apps/web/src/features/settings/calendar/queries.ts` | 🔄 |
| `hooks/useCalendarsSettings.ts` | merge no acima | 🔄 |
| `hooks/useCompanySettings.ts` | `apps/web/src/features/settings/workspace/queries.ts` | 🔄 |
| `hooks/useConfirmation.ts` | `apps/web/src/shared/hooks/useConfirmation.ts` | ✅ |
| `hooks/useGeolocation.ts` | `apps/web/src/shared/hooks/useGeolocation.ts` | ✅ (deal attachments) |
| `hooks/useImageUpload.ts` | `apps/web/src/shared/hooks/useImageUpload.ts` | 🔄 (R2 signed URL) |
| `hooks/useProfileSettings.ts` | `apps/web/src/features/settings/profile/queries.ts` | 🔄 |
| `hooks/useToast.ts` | `apps/web/src/shared/hooks/useToast.ts` | 🔄 (unificado) |
| `hooks/useAutomationRules.ts` | — | ❌ |
| `hooks/useConversationHistory.ts` | `apps/web/src/features/agents/hooks/useConversationHistory.ts` | 🔄 |
| `hooks/useDashboard.ts` | split em features/dashboard | 🔄 |
| `hooks/useOverviewData.ts` | merge dashboard | 🔄 |
| `hooks/useInboxesSettings.ts` | `apps/web/src/features/settings/channels/queries.ts` | 🔄 |
| `hooks/useCadastro.ts`, `useCadastroStatus.ts`, `useSignup.ts` | — | ❌ |

### 16.4 Lib

| v1 | v2 | Status |
|---|---|---|
| `lib/api.ts` | `apps/web/src/shared/lib/api-client.ts` | 🔄 |
| `lib/fetch.ts` | merge api-client | 🔄 |
| `lib/design-system.ts` (220 linhas legado) | — | ❌ |
| `lib/form-utils.ts` (useFormValidation manual) | — | ❌ (substituído por RHF) |
| `lib/supabase.ts` | — | ❌ (não precisa no frontend; usa API endpoints) |
| `lib/utils.ts` | `apps/web/src/shared/utils/index.ts` | 🔄 |

### 16.5 Components ui (legado)

Todos em `frontend/src/components/ui/*` ficam ❌. **NENHUM componente UI do v1 é portado.** O `packages/ui` v2 reescreve do zero com tokens novos.

Stories e referência visual: `EmpresaPanel.refactored.example.tsx` mostra direção correta. Usar como mental model, não código.

### 16.6 Components comuns

| v1 | v2 | Status |
|---|---|---|
| `components/ToastContainer.tsx` | — | ❌ |
| `components/common/ToastContainer.tsx` | — | ❌ |
| `components/header.tsx` | `apps/web/src/shared/layout/AppTopBar.tsx` | 🔄 |
| `components/MentionInput.tsx` | `apps/web/src/shared/components/MentionInput.tsx` | 🔄 (notes only no MVP) |
| `components/MessageWithMentions.tsx` | `apps/web/src/shared/components/MessageWithMentions.tsx` | 🔄 |
| `components/tabelacli.tsx` | — | ❌ |
| `components/dashboards/dashboard-aten.tsx` | `apps/web/src/features/dashboard/components/ServiceDashboard.tsx` | 🔄 |
| `components/dashboards/dashboard-orca.tsx` | — | ❌ (vertical solar) |

### 16.7 Components/livechat (chat domain)

| v1 | v2 | Status |
|---|---|---|
| `components/livechat/ChatList.tsx` | `apps/web/src/features/conversations/components/ChatList.tsx` | 🔄 |
| `components/livechat/ChatListFlowBadge.tsx` | `apps/web/src/features/conversations/components/FlowExecutionBadge.tsx` | 🔄 |
| `components/livechat/ConversationPanel.tsx` | `apps/web/src/features/conversations/components/ConversationPanel.tsx` | 🔄 |
| `components/livechat/MessageBubble.tsx` | `apps/web/src/features/conversations/components/MessageBubble.tsx` (discriminated union) | 🔄 |
| `components/livechat/MessageComposer.tsx` (inferido) | port | 🔄 |
| `components/livechat/QuotedMessage.tsx` | port | 🔄 |
| `components/livechat/ChatHeader.tsx` | `apps/web/src/features/conversations/components/ConversationHeader.tsx` | 🔄 |
| `components/livechat/ContactInfoPanel.tsx` | port | 🔄 |
| `components/livechat/ContactsCRM.tsx` | `apps/web/src/features/contacts/` | 🔄 |
| `components/livechat/DepartmentFilter.tsx` | port | 🔄 |
| `components/livechat/DepartmentBadge.tsx` | port | 🔄 |
| `components/livechat/AudioPlayerWhatsApp.tsx` | port (DS v2 styling) | 🔄 |
| `components/livechat/AudioRecorderModal.tsx` | port | 🔄 |
| `components/livechat/ConnectionIndicator.tsx` | port | 🔄 |
| `components/livechat/CampaignEditorDrawer.tsx` | `apps/web/src/features/campaigns/components/CampaignEditorDrawer.tsx` | 🔄 |
| `components/livechat/CampaignsPanel.tsx` | `apps/web/src/features/campaigns/pages/CampaignsPage.tsx` | 🔄 |
| `components/livechat/FirstInboxWizard.tsx` | `apps/web/src/features/onboarding/FirstChannelWizard.tsx` | 🔄 |
| `components/livechat/DynamicWindowsEditor.tsx` | port (DS v2) | 🔄 |
| `components/livechat/MetaTemplateTypes.ts` | `packages/shared/src/types/meta-template.types.ts` | 🔄 |
| `components/livechat/flow-builder/*` | `apps/web/src/features/flow-builder/*` | 🔄 (mantém estrutura modular dos nodes; FX-029a-d/FX-031a-d) |

### 16.8 Components/agents

| v1 | v2 | Status |
|---|---|---|
| `components/agents/AgentCreationWizard.tsx` | `apps/web/src/features/agents/components/AgentCreationWizard.tsx` | 🔄 (RHF) |
| `components/agents/AgentsPanel.tsx` | port | 🔄 |
| `components/agents/InboxMultiSelect.tsx` | `apps/web/src/features/agents/components/ChannelMultiSelect.tsx` | 🔄 |
| `components/agents/SimplifiedAgentPanel.tsx` | merge AgentsPanel | 🔄 |
| `components/agents/TemplatesAdminPanel.tsx` | `apps/web/src/features/admin/agents/TemplatesAdminPage.tsx` | 🔄 |
| `components/agents/TemplateToolsManager.tsx` | port | 🔄 |
| `components/agents/analytics/*` | port DS v2 | 🔄 |
| `components/agents/configuration/AgentConfigEditor.tsx` | port | 🔄 |
| `components/agents/configuration/InboxSelector.tsx` | rename ChannelSelector | 🔄 |
| `components/agents/configuration/KnowledgeBaseManager.tsx` | port + RAG view | 🔄 |
| `components/agents/configuration/ModelParameters.tsx` | port | 🔄 |
| `components/agents/configuration/PlaygroundChat.tsx` | port (SSE LangGraph) | 🔄 |
| `components/agents/configuration/PromptEditor.tsx` | port | 🔄 |
| `components/agents/configuration/RulesManager.tsx` | — | ❌ (substituído por Flow Builder) |
| `components/agents/monitoring/*` | port | 🔄 |
| `components/agents/shared/AgentSelector.tsx` | port | 🔄 |
| `components/agents/shared/AgentStatusBadge.tsx` | port | 🔄 |
| `components/agents/shared/LoadingStates.tsx` | — | ❌ (usa Skeleton do `packages/ui`) |
| `components/agents/training/*` | port (feedback + prompt library) | 🔄 |

### 16.9 Components/dashboard

| v1 | v2 | Status |
|---|---|---|
| `components/dashboard/AlertsPanel.tsx` | `apps/web/src/features/dashboard/components/AlertsPanel.tsx` | 🔄 |
| `components/dashboard/Charts.tsx` | port (Recharts + DS v2 colors) | 🔄 |
| `components/dashboard/KPICard.tsx` | substituído por `packages/ui/Stat.tsx` | 🔄 |

### 16.10 Components/funil

| v1 | v2 | Status |
|---|---|---|
| `components/funil/CardImageCapture.tsx` | `apps/web/src/features/pipeline/components/DealAttachmentCapture.tsx` | 🔄 |
| `components/funil/CardImageGallery.tsx` | `apps/web/src/features/pipeline/components/DealAttachmentGallery.tsx` | 🔄 |
| `components/funil/ImageWithMetadata.tsx` | port (canvas overlay) | 🔄 |
| `components/funil/KanbanSetupModal.tsx` | `apps/web/src/features/pipeline/components/PipelineSetupModal.tsx` | 🔄 |
| `components/funil/NewColumnForm.tsx` | `apps/web/src/features/pipeline/components/NewStageForm.tsx` | 🔄 |
| `components/funil/LeadPicker.tsx` | `apps/web/src/features/pipeline/components/ContactPicker.tsx` | 🔄 |

### 16.11 Components/calendar

| v1 | v2 | Status |
|---|---|---|
| `components/calendar/CalendarEmbed.tsx` | `apps/web/src/features/calendar/components/CalendarView.tsx` | 🔄 |

### 16.12 Components/company

| v1 | v2 | Status |
|---|---|---|
| `components/company/EmpresaPanel.tsx` (262 linhas) | `apps/web/src/features/settings/workspace/components/WorkspacePanel.tsx` | 🔄 |
| `components/company/EmpresaPanel.refactored.example.tsx` (150 linhas) | — | ❌ (era exemplo de migração; agora padrão) |
| `components/company/PlansSection.tsx` | `apps/web/src/features/settings/billing/PlansSection.tsx` | 🔄 (feature flag) |

### 16.13 Components/customers

| v1 | v2 | Status |
|---|---|---|
| `components/customers/ClienteDetailsModal.tsx` | `apps/web/src/features/contacts/components/ContactDetailsDrawer.tsx` | 🔄 |
| `components/customers/ClienteTasksSection.tsx` | merge em DealDetails | 🔄 |
| `components/clientes/ClienteForm.tsx` | `apps/web/src/features/contacts/components/ContactForm.tsx` | 🔄 (RHF) |

### 16.14 Components/admin

| v1 | v2 | Status |
|---|---|---|
| `components/admin/AgentsAdminPanel.tsx` | `apps/web/src/features/admin/agents/AgentsAdminPage.tsx` | 🔄 |
| `components/admin/AgentToolsManager.tsx` | port | 🔄 |
| `components/admin/CompaniesManager.tsx` | `apps/web/src/features/admin/workspaces/WorkspacesPage.tsx` | 🔄 |
| `components/admin/EditIndustryModal.tsx` | — | ❌ (industry config dropped) |
| `components/admin/IndustryBadge.tsx` | — | ❌ |

### 16.15 Components/auth

| v1 | v2 | Status |
|---|---|---|
| `components/auth/FeatureGuard.tsx` | `apps/web/src/shared/components/FeatureGuard.tsx` | 🔄 |
| `components/auth/RequireAuth.tsx` | `apps/web/src/core/auth/RequireAuth.tsx` | 🔄 |

### 16.16 Components/gallery / media

| v1 | v2 | Status |
|---|---|---|
| `components/gallery/MediaCard.tsx` | — | ❌ (galeria de produtos descartada) |
| `components/cadastro/OnboardingModal.tsx` | — | ❌ (fase 2) |

### 16.17 Pages

Todas as pages v1 mudam de lugar/nome. Resumo:

| v1 `pages/` | v2 `features/<X>/pages/` | Status |
|---|---|---|
| `pages/dashboard/*` | `features/dashboard/pages/*` | 🔄 |
| `pages/livechat/*` | `features/conversations/pages/*` | 🔄 |
| `pages/funil-vendas.tsx` | `features/pipeline/pages/PipelinePage.tsx` | 🔄 |
| `pages/funil/*` | merge pipeline | 🔄 |
| `pages/clientes/*` | `features/contacts/pages/*` | 🔄 |
| `pages/tarefas/*` | — | ❌ (sub-tasks em deal cobrem MVP) |
| `pages/calendario/*` | `features/calendar/pages/*` | 🔄 |
| `pages/produtos/*` | — | ❌ |
| `pages/documentos/*` | — | ❌ |
| `pages/agents/*` | `features/agents/pages/*` | 🔄 |
| `pages/projects/*` | — | ❌ (substituído por pipeline genérico) |
| `pages/configuracoes/*` | `features/settings/pages/*` | 🔄 |
| `pages/admin/*` | `features/admin/pages/*` | 🔄 |
| `pages/cadastro/*` | — | ❌ (fase 2) |
| `pages/login/index.tsx` | `features/auth/pages/LoginPage.tsx` | 🔄 |
| `pages/reset-password/index.tsx` | `features/auth/pages/ResetPasswordPage.tsx` | 🔄 |
| `pages/subscription-success/index.tsx` | `features/billing/pages/SubscriptionSuccessPage.tsx` | 🔄 |
| `pages/notifications/*` | `features/notifications/pages/*` | 🔄 |
| `pages/perfil/*` | `features/settings/profile/pages/*` | 🔄 |
| `pages/automation-rules/*` | — | ❌ |
| `pages/galeria/*` | — | ❌ |
| `pages/templates/*` | — | ❌ |
| `pages/admin.tsx`, `pages/calendar.tsx`, `pages/clientes.tsx`, `pages/AutomationRulesPage.tsx` | — | ❌ (órfãs) |

### 16.18 Pages admin específicas

| v1 | v2 | Status |
|---|---|---|
| `pages/admin/dashboard/AdminDashboard.tsx` | `features/admin/pages/DashboardPage.tsx` | 🔄 |
| `pages/admin/companies/CompaniesList.tsx`, `CompanyDetails.tsx` | `features/admin/pages/Workspaces*.tsx` | 🔄 |
| `pages/admin/companies-views/*` (8 tabs) | port renomeando | 🔄 |
| `pages/admin/infrastructure/SystemHealth.tsx` + 5 tabs | `features/admin/pages/InfrastructurePage.tsx` + tabs | 🔄 |
| `pages/admin/Templates/*` (Editor + Tester) | port | 🔄 |
| `pages/admin/Tools/ToolMonitoring.tsx` | port | 🔄 |
| `pages/projects/templates/*` | — | ❌ (project templates descartado, pelo menos no MVP) |

---

## 17. cadastro/ + landing/ (workspaces v1)

| v1 workspace | v2 |
|---|---|
| `cadastro/*` | — fase 2 |
| `landing/*` | — fase 2 |

---

## 18. SQL files

| v1 `backend/sql/` | v2 `packages/db/migrations/` | Status |
|---|---|---|
| 47 migrations numeradas + 30 ad-hoc | 22 migrations limpas (vide DATA_MODEL §17) | 🔄 (não portar; refazer schema) |
| Funções PG críticas: `compute_available_slots`, `search_knowledge_base`, `update_updated_at_column` | port em migration | 🔄 (`search_knowledge_base` agora com pgvector) |

---

## 19. Testes

Padrão v2: cada package tem `vitest.config.ts` + tests perto do código:

- `packages/db/src/repos/conversations.repo.test.ts`
- `packages/agents/src/tools/calendar/schedule.tool.test.ts`
- `packages/flow-engine/src/handlers/condition.handler.test.ts`
- `apps/api/src/routes/conversations/list.test.ts` (integration)
- `apps/web/src/features/conversations/components/MessageBubble.test.tsx`

Integration tests usam `testcontainers` para Postgres + RabbitMQ + Redis reais. OpenAI mockado via msw ou fixture.

E2e em `e2e/` na raiz, Playwright, testa flow completo do produto.

---

## 20. Configs/build

| v1 | v2 |
|---|---|
| `tsup.config.ts` (4 entries) | `apps/api/tsup.config.ts` (1 entry) + `apps/workers/tsup.config.ts` (5 entries por command arg) |
| `tsconfig.json` por workspace | `tsconfig.base.json` + `tsconfig.json` por package extendendo |
| `eslint.config.js` root | mantém pattern |
| `vite.config.ts` | substituído por `apps/web/next.config.mjs` (Next.js 15 App Router) |
| `docker-compose.prod.yml` | `infra/docker/docker-compose.prod.yml` (refator) |
| `deploy.sh` | `infra/scripts/deploy.sh` (refator) |
| `Dockerfile` (cada workspace) | `infra/docker/{api,workers,web,agent-runtime}.Dockerfile` consolidados |

---

> Esse mapa é vivo. Ao portar cada arquivo, **marca aqui** com nota da decisão final (ex: "merged em X", "renamed para Y"). Vira artefato histórico do refactoring.
