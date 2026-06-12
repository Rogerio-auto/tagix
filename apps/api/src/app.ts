import compression from 'compression';
import express, { type Express } from 'express';
import { createAuthRouter } from './auth';
import { loadConfig } from './config';
import { healthHandler } from './health';
import { errorHandler } from './middlewares/error';
import { securityMiddlewares } from './middlewares/security';
import { createInternalToolsRouter } from './internal/tools';
import { buildWorkflowRegistry } from './internal/tools/workflow-handlers';
import { registerCalendarHandlers } from './internal/tools/calendar-handlers';
import { createAgentsRouter } from './routes/agents';
import { createChannelsRouter } from './routes/channels';
import { createConversationsRouter } from './routes/conversations';
import { createKnowledgeRouter } from './routes/knowledge';
import { createKnowledgeFeedbackRouter } from './routes/knowledge/feedback';
import { createMessagesRouter } from './routes/conversations/messages';
import { createNotesRouter } from './routes/conversations/notes';
import { createRoutingRouter } from './routes/conversations/routing';
import { createWindowRouter } from './routes/conversations/window';
import { createWebhooksRouter } from './routes/webhooks';
import { createFlowSubmissionsRouter } from './routes/flows/submissions';
import { createFlowsRouter } from './routes/flows';
import { createPipelineRouter } from './routes/pipeline';
import { createDealsRouter } from './routes/deals';
import { registerDealHooks } from './services/deal-hooks';
import { registerEventHooks } from './services/event-hooks';
import { createConversionsRouter } from './routes/conversions';
import { createCampaignsRouter } from './routes/campaigns';
import { createCampaignRecipientsRouter } from './routes/campaigns/recipients';
import { createContactsRouter } from './routes/contacts';
import { createOnboardingRouter } from './routes/onboarding';
import { createCalendarRouter } from './routes/calendar';
import { createDashboardRouter } from './routes/dashboard';
import { createMembersMeRouter } from './routes/members/me';
import { createWorkspaceSettingsRouter } from './routes/workspace';
import { createOrgSettingsRouter } from './routes/org';
import { createTagsRouter } from './routes/tags';
import { createAuditRouter } from './routes/audit';
import { createDashboardLayoutRouter } from './routes/members/dashboard-layout';
import { createV1Router } from './routes/v1';
import { createDevRouter } from './routes/dev';
import { createPrivacyRouter } from './routes/privacy';
import {
  initSentry,
  metricsMiddleware,
  metricsHandler,
  sentryErrorHandler,
} from './observability';

/** Monta o app Express 5 com middlewares de segurança + rotas de auth + /health. */
export function createApp(): Express {
  // Valida env no boot (fail-fast). A allowlist CORS é lida da env dentro do
  // security middleware (F10-S07), não mais aqui.
  loadConfig();
  // Observabilidade (F10-S01): Sentry opt-in (no-op sem DSN) iniciado no boot.
  initSentry();
  const app = express();

  // Seam onStageChanged (F5-S06/S07): socket emit + automation scheduling.
  registerDealHooks();
  // Seam onEventChanged (F7-S05): cancelamento de evento → notifica participantes.
  registerEventHooks();

  app.disable('x-powered-by');
  // Security hardening (F10-S07): helmet+CSP+HSTS+CORS allowlist endurecidos.
  for (const mw of securityMiddlewares()) app.use(mw);
  app.use(compression());

  // Métricas (F10-S01): mede duração/contagem de toda request (antes das rotas).
  app.use(metricsMiddleware);

  // Webhooks ANTES do json global: as rotas POST usam express.raw p/ HMAC Meta
  // (exige os bytes exatos recebidos). Ver routes/webhooks/index.ts.
  app.use(createWebhooksRouter());

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', healthHandler);
  // Scrape Prometheus (F10-S01): fora de auth/api-key (rede interna).
  app.get('/metrics', metricsHandler);
  // Endpoint interno service-to-service (runtime Python → Node): auth por token
  // compartilhado (AGENT_RUNTIME_TOKEN), NÃO por sessão de usuário. Ver F2-S07/S20.
  app.use(
    createInternalToolsRouter({
      registry: registerCalendarHandlers(buildWorkflowRegistry()),
    }),
  );
  app.use(createAuthRouter());
  app.use(createConversationsRouter());
  app.use(createMessagesRouter());
  app.use(createWindowRouter());
  app.use(createNotesRouter());
  app.use(createRoutingRouter());
  app.use(createChannelsRouter());
  app.use(createAgentsRouter());
  app.use(createKnowledgeRouter());
  app.use(createKnowledgeFeedbackRouter());
  // Flow Builder API (F4-S08): CRUD + publish + trigger + executions.
  app.use(createFlowsRouter());
  // Meta Flow submissions (F4-S14): endpoint interno de despacho do webhook.
  app.use(createFlowSubmissionsRouter());
  // Pipeline/funil (F5-S04): CRUD pipelines + stages.
  app.use(createPipelineRouter());
  // Deals (F5-S05): CRUD + move-stage + close/reopen + anexos.
  app.use(createDealsRouter());
  // Conversoes (F5-S12): CRUD types + register/list/cancel events.
  app.use(createConversionsRouter());
  app.use(createCampaignsRouter());
  app.use(createCampaignRecipientsRouter());
  // Contatos (F8-S09): CRUD geral + busca/filtros + tags + consentimento; inclui opt-in (F6).
  app.use(createContactsRouter());
  // Onboarding por nicho (F5-S15): cria pipeline + agente a partir de template.
  app.use(createOnboardingRouter());
  // Calendar (F7): CRUD calendars + availability rules/exceptions + slots.
  app.use(createCalendarRouter());
  // Dashboard (F8-S02): GET /dashboard/me role-filtered + drill-down /metrics/:key.
  app.use(createDashboardRouter());
  // Settings pessoais (F8-S06): PATCH /members/me + password + sessions.
  app.use(createMembersMeRouter());
  // Dashboard customização (F8-S04): layout pessoal + config de obrigatórios/limites.
  app.use(createDashboardLayoutRouter());
  // Settings workspace (F8-S07): PATCH /workspace + membros + org (depts/teams/SLA).
  app.use(createWorkspaceSettingsRouter());
  app.use(createOrgSettingsRouter());
  // Settings dados (F8-S08): tags CRUD + audit viewer.
  app.use(createTagsRouter());
  app.use(createAuditRouter());
  // Privacidade/LGPD (F10-S02): export assíncrono + forget (anonimização). Owner/Admin.
  app.use(createPrivacyRouter());
  // API pública v1 (F9-S03): gated por API key + scope; OpenAPI/Swagger em /api/v1/docs.
  app.use(createV1Router());
  // Gestão Dev (F9-S04): session-authed CRUD de API keys + webhooks (Settings → Dev).
  app.use(createDevRouter());

  // Sentry error handler (F10-S01) ANTES do handler central: captura a exceção
  // (no-op sem DSN) e repassa para a resposta de erro canônica.
  app.use(sentryErrorHandler());
  // Error handler por último (Express 5 captura erros de handlers async).
  app.use(errorHandler);
  return app;
}
