import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { createAuthRouter } from './auth';
import { loadConfig } from './config';
import { healthHandler } from './health';
import { errorHandler } from './middlewares/error';
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

/** Monta o app Express 5 com middlewares de segurança + rotas de auth + /health. */
export function createApp(): Express {
  const config = loadConfig();
  const app = express();

  // Seam onStageChanged (F5-S06/S07): socket emit + automation scheduling.
  registerDealHooks();
  // Seam onEventChanged (F7-S05): cancelamento de evento → notifica participantes.
  registerEventHooks();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(compression());

  // Webhooks ANTES do json global: as rotas POST usam express.raw p/ HMAC Meta
  // (exige os bytes exatos recebidos). Ver routes/webhooks/index.ts.
  app.use(createWebhooksRouter());

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', healthHandler);
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

  // Error handler por último (Express 5 captura erros de handlers async).
  app.use(errorHandler);
  return app;
}
