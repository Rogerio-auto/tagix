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
import { createAgentToolsRouter } from './tools';

export function createAgentsRouter(): Router {
  const router = Router();
  router.use(createAgentToolsRouter());
  router.use(createAgentsCrudRouter());
  return router;
}
