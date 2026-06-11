/** Estrutura org (departments/teams/SLA) — F8-S07. Montado em app.ts. */
import { Router } from 'express';
import { createOrgRouter } from './org';

export function createOrgSettingsRouter(): Router {
  const router = Router();
  router.use(createOrgRouter());
  return router;
}

export { createOrgRouter } from './org';
