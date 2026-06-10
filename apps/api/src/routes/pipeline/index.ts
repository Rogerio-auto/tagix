/**
 * Agregador das rotas do dominio Pipeline (F5-S04, PIPELINE.md 10).
 * Monta CRUD de pipelines + CRUD/reorder de stages. Os endpoints literais
 * (.../reorder) sao registrados ANTES do CRUD :id pelos sub-routers.
 * Montado em app.ts pelo orchestrator (padrao F2-S19/F4-S08).
 */
import { Router } from 'express';
import { createPipelinesRouter } from './pipelines';
import { createStagesRouter } from './stages';

export function createPipelineRouter(): Router {
  const router = Router();
  router.use(createStagesRouter());
  router.use(createPipelinesRouter());
  return router;
}

export { createPipelinesRouter } from './pipelines';
export { createStagesRouter } from './stages';
