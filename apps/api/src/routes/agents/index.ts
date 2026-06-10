/**
 * Agregador das rotas de agentes IA (F2-S16).
 *
 * Monta os sub-routers de CRUD de `agents` e de catálogo/toggle de `tools`.
 *
 * Ordem importa: o router de tools é registrado ANTES do CRUD porque
 * `GET /api/agents/tools` colidiria com o param `GET /api/agents/:id` do CRUD
 * (Express casa `:id` = "tools"). Registrando tools primeiro, a rota literal
 * `/api/agents/tools` ganha precedência sobre o param.
 *
 * NÃO inclui o playground/SSE — esse é dono do F2-S19 (`routes/agents/playground.ts`),
 * montado separadamente pelo orchestrator em `app.ts`.
 */
import { Router } from 'express';
import { createAgentsCrudRouter } from './crud';
import { createAgentMetricsRouter } from './metrics';
import { createAgentModelsRouter } from './models';
import { createAgentTemplatesRouter } from './templates';
import { createAgentToolsRouter } from './tools';

export function createAgentsRouter(): Router {
  const router = Router();
  // Rotas literais (tools/models/templates) ANTES do CRUD: senão `:id` casa
  // "tools"/"models"/"templates". Ver nota de precedência acima.
  router.use(createAgentToolsRouter());
  router.use(createAgentModelsRouter());
  router.use(createAgentTemplatesRouter());
  router.use(createAgentMetricsRouter());
  router.use(createAgentsCrudRouter());
  return router;
}
