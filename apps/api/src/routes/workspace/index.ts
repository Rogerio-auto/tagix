/** Workspace settings + membros (F8-S07). Montado em app.ts. */
import { Router } from 'express';
import { createWorkspaceRouter } from './workspace';

export function createWorkspaceSettingsRouter(): Router {
  const router = Router();
  router.use(createWorkspaceRouter());
  return router;
}

export { createWorkspaceRouter } from './workspace';
