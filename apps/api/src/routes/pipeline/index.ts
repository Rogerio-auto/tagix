/**
 * Agregador das rotas do dominio Pipeline (F5-S04, PIPELINE.md 10).
 * Monta CRUD de pipelines + CRUD/reorder de stages. Os endpoints literais
 * (.../reorder) sao registrados ANTES do CRUD :id pelos sub-routers.
 * Montado em app.ts pelo orchestrator (padrao F2-S19/F4-S08).
 */
import { Router } from 'express';
import { createDealConversationRouter } from './deal-conversation';
import { createDealItemsRouter } from './items';
import { createPipelinesRouter } from './pipelines';
import { createStagesRouter } from './stages';

export function createPipelineRouter(): Router {
  const router = Router();
  router.use(createStagesRouter());
  // Card-da-conversa + read-through + snapshot (F47-S04). Montado ANTES de deals
  // (em app.ts) para que `GET /api/deals/:id` enriquecido e o pré-handler de
  // snapshot no close precedam o CRUD canônico.
  router.use(createDealConversationRouter());
  router.use(createDealItemsRouter());
  router.use(createPipelinesRouter());
  return router;
}

export {
  createDealConversationRouter,
  ensureDealForConversation,
  snapshotContactForDeal,
} from './deal-conversation';
export { createDealItemsRouter } from './items';
export { createPipelinesRouter } from './pipelines';
export { createStagesRouter } from './stages';
