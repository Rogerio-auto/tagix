import compression from 'compression';
import express, { type Express } from 'express';
import { createAuthRouter } from './auth';
import { loadConfig } from './config';
import { healthHandler } from './health';
import { errorHandler } from './middlewares/error';
import { securityMiddlewares } from './middlewares/security';
import { uuidParamGuard } from './middlewares/uuid-params';
import { createInternalToolsRouter } from './internal/tools';
import { buildWorkflowRegistry } from './internal/tools/workflow-handlers';
import { registerCalendarHandlers } from './internal/tools/calendar-handlers';
import { createAgentsRouter } from './routes/agents';
import { createChannelsRouter } from './routes/channels';
import { createInstagramRouter } from './routes/instagram';
import { createConversationsRouter } from './routes/conversations';
import { createKnowledgeRouter } from './routes/knowledge';
import { createKnowledgeFeedbackRouter } from './routes/knowledge/feedback';
import { createMessagesRouter } from './routes/conversations/messages';
import { createNotesRouter } from './routes/conversations/notes';
import { createRoutingRouter } from './routes/conversations/routing';
import { createConversationStateRouter } from './routes/conversations/state';
import { createConversationAgentRouter } from './routes/conversations/agent';
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
import { createProductsRouter } from './routes/products';
import { createUsageRouter } from './routes/usage';
import { createUploadsRouter } from './routes/uploads';
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
import { createBillingRouter } from './routes/billing';
import { createPrivacyRouter } from './routes/privacy';
import { createHelpRouter } from './routes/help';
import { createSupportRouter } from './routes/support';
import { createPlatformModelsRouter } from './routes/platform/models';
import { createPlatformPoliciesRouter } from './routes/platform/policies';
import { createPlatformSecretsRouter } from './routes/platform/secrets';
import { createPlatformUsageRouter } from './routes/platform/usage';
import { createPlatformWorkspacesRouter } from './routes/platform/workspaces';
import { createPlatformPlansRouter } from './routes/platform/plans';
import { createPlatformSubscriptionsRouter } from './routes/platform/subscriptions';
import { createPlatformImpersonationRouter } from './routes/platform/impersonation';
import { createPlatformPlaygroundRouter } from './routes/platform/playground';
import { createPlatformHelpRouter, createPlatformSupportRouter } from './routes/platform';
import { createMonitoringRouter } from './routes/monitoring';
import {
  IMPERSONATION_COOKIE,
  impersonationMiddleware,
} from './middlewares/impersonation';
import { requireAuth } from './middlewares/auth';
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

  // Atrás do Traefik (1 hop) em produção: só o proxy reverso é confiável para
  // resolver o IP real do cliente (`req.ip`). CRÍTICO para o rate-limit de auth —
  // sem isto o `X-Forwarded-For` enviado pelo cliente seria confiável e o limite por
  // IP seria burlável por spoof (gira a chave do Redis a cada request). Em dev (sem
  // proxy) NÃO confia em XFF → `req.ip` = IP do socket.
  app.set('trust proxy', process.env['NODE_ENV'] === 'production' ? 1 : false);

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

  // Backup de Flows (F50): import/preview trafegam o bundle JSON (pode passar de 1mb) — parser
  // dedicado ANTES do json global (que rejeitaria com 413). Caps de contagem no Zod evitam DoS.
  app.use(['/api/flows/backup/import', '/api/flows/backup/preview'], express.json({ limit: '10mb' }));

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

  // View-as / impersonation (F26-S05): quando ha um claim de impersonation no
  // cookie, resolve a sessao do admin (requireAuth) e aplica o middleware que
  // sobrepoe o workspace-ALVO + impoe read-only (bloqueia escrita/plataforma/
  // secrets). Sem o cookie e NO-OP -> nao perturba nenhuma rota existente. Roda
  // DEPOIS do auth (req.auth populado) e ANTES das rotas de workspace.
  app.use((req, res, next) => {
    if (!req.headers.cookie?.includes(`${IMPERSONATION_COOKIE}=`)) {
      next();
      return;
    }
    void requireAuth(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      if (res.headersSent) return; // requireAuth ja respondeu 401
      impersonationMiddleware(req, res, next);
    });
  });

  // Guard de path-params UUID (route-audit): id malformado em posição de :id-UUID
  // → 404 limpo (contrato IDOR), evitando que o Postgres lance e vire 500. Atua só
  // em /api/* e ignora segmentos estáticos/literais (me, current, models, …).
  app.use(uuidParamGuard);

  app.use(createConversationsRouter());
  app.use(createMessagesRouter());
  app.use(createWindowRouter());
  app.use(createNotesRouter());
  app.use(createRoutingRouter());
  // Estado operacional da conversa (F30-S02): status (resolver/snooze/reabrir) +
  // toggle de ai_mode (on/off/paused) com handoff consciente.
  app.use(createConversationStateRouter());
  // Troca manual do agente de IA da conversa (F34-S04): GET candidatos + POST troca,
  // gated por conversation.assign_agent, re-engaja via hm.q.flows e emite socket.
  app.use(createConversationAgentRouter());
  app.use(createChannelsRouter());
  app.use(createInstagramRouter());
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
  // Catálogo de produtos (F47-S02): CRUD do catálogo comercial do workspace
  // (product.view/product.edit), consumido pelo cockpit (S07) e settings (S05).
  app.use(createProductsRouter());
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
  // Billing self-serve (F41-S04): checkout hospedado (CARD+PIX) + estado + cancel.
  // Preço/plano reconferidos server-side; webhook (S03) confirma o pagamento.
  app.use(createBillingRouter());

  // F38: leitor da Central de Ajuda (qualquer membro autenticado; só published).
  app.use(createHelpRouter());
  // F38: chat de suporte do membro (workspace-scoped; assertThreadVisible → 404).
  app.use(createSupportRouter());
  // Uso e custo LLM do workspace (tenant-scoped via RLS) — alimenta /settings/usage,
  // destino de drill dos cards "Custo IA" do dashboard. Gated por agent.view_costs.
  app.use(createUsageRouter());
  // Upload de mídia do LiveChat (outbound): recebe o arquivo cru, sobe no R2 e
  // devolve a URL assinada (mediaUrl da mensagem). express.raw é por-rota.
  app.use(createUploadsRouter());

  // Observabilidade da sincronização (F52-S09): GET /api/monitoring/sync-health —
  // profundidade de filas + DLQ + pendências (RLS) + status de canal WhatsApp.
  // Gated por OWNER/ADMIN do workspace ou platform-admin (defesa em profundidade).
  app.use(createMonitoringRouter());

  // Super-admin de plataforma (F2.5/F25): catálogo de modelos, políticas por
  // workspace, rotação de secrets e rollup de custo LLM. Cada router já é gated
  // internamente por requirePlatformAdmin (F25-S01) — fronteira única da camada
  // de plataforma (sem RLS de tenant). Acima de workspace.
  app.use(createPlatformModelsRouter());
  app.use(createPlatformPoliciesRouter());
  app.use(createPlatformSecretsRouter());
  app.use(createPlatformUsageRouter());
  // F26: Tenants/360, catalogo de planos, assinatura+entitlements por tenant,
  // e sessoes de view-as. Cada router e gated por requirePlatformAdmin.
  app.use(createPlatformWorkspacesRouter());
  app.use(createPlatformPlansRouter());
  app.use(createPlatformSubscriptionsRouter());
  app.use(createPlatformImpersonationRouter());
  // F26-S10 (glue): proxy SSE do playground em sandbox (zero side-effect).
  app.use(createPlatformPlaygroundRouter());
  // F38: CMS da Central de Ajuda (gated por requirePlatformAdmin).
  app.use(createPlatformHelpRouter());
  // F38: inbox de suporte cross-workspace (gated por requirePlatformAdmin).
  app.use(createPlatformSupportRouter());

  // Sentry error handler (F10-S01) ANTES do handler central: captura a exceção
  // (no-op sem DSN) e repassa para a resposta de erro canônica.
  app.use(sentryErrorHandler());
  // Error handler por último (Express 5 captura erros de handlers async).
  app.use(errorHandler);
  return app;
}
