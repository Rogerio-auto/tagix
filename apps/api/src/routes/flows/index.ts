/**
 * Agregador das rotas do Flow Builder (F4-S08, FLOW_BUILDER.md secao 10).
 *
 * Monta CRUD/lifecycle + executions. O `manual-order` e as rotas literais sao
 * registradas ANTES do CRUD `:id` (precedencia Express). O handler de Meta Flow
 * submissions (F4-S14, `submissions.ts`) e montado SEPARADAMENTE pelo orchestrator
 * em `app.ts` (nao entra aqui — pertence ao webhook, nao ao CRUD autenticado).
 */
import { Router } from 'express';
import { createFlowsCrudRouter } from './crud';
import { createFlowExecutionsRouter } from './executions';

export function createFlowsRouter(): Router {
  const router = Router();
  router.use(createFlowExecutionsRouter());
  router.use(createFlowsCrudRouter());
  return router;
}

export { createFlowsCrudRouter } from './crud';
export { createFlowExecutionsRouter } from './executions';
