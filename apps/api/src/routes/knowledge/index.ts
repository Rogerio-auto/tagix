/**
 * Agregador das rotas da Knowledge Base (F3-S04).
 *
 * Monta o CRUD de documentos. Montado em app.ts pelo orchestrator
 * (padrao F2-S19), nao auto-registrado.
 */
import { Router } from 'express';
import { createKnowledgeCrudRouter } from './crud';

export function createKnowledgeRouter(): Router {
  const router = Router();
  router.use(createKnowledgeCrudRouter());
  return router;
}
