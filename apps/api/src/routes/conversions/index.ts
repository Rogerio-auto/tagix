/**
 * Agregador das rotas do dominio Conversoes (F5-S12, DATA_MODEL §10.7).
 * CRUD de conversion_types + register/list/cancel de events. O servico
 * registerConversion e exportado p/ reuso (F2-S20 agent tool, F5-S14 automacoes).
 * Montado em app.ts pelo orchestrator.
 */
import { Router } from 'express';
import { createConversionTypesRouter } from './types';
import { createConversionEventsRouter } from './events';

export function createConversionsRouter(): Router {
  const router = Router();
  router.use(createConversionEventsRouter());
  router.use(createConversionTypesRouter());
  return router;
}

export { createConversionTypesRouter } from './types';
export { createConversionEventsRouter } from './events';
export {
  registerConversion,
  type RegisterConversionInput,
  type RegisterConversionResult,
  type ConversionSource,
} from './register';
