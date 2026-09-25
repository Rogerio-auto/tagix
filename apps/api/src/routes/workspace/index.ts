/** Workspace settings + membros (F8-S07). Montado em app.ts. */
import { Router } from 'express';
import { createWorkspaceRouter } from './workspace';
import { createAiOriginLockRouter } from './ai-origin-lock';

export function createWorkspaceSettingsRouter(): Router {
  const router = Router();
  router.use(createWorkspaceRouter());
  // F70-S30: trava de origem da IA (OWNER/ADMIN, auditada).
  router.use(createAiOriginLockRouter());
  return router;
}

export { createWorkspaceRouter } from './workspace';
export { createAiOriginLockRouter } from './ai-origin-lock';
