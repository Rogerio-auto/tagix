/** Workspace settings + membros (F8-S07). Montado em app.ts. */
import { Router } from 'express';
import { createWorkspaceRouter } from './workspace';
import { createAiOriginLockRouter } from './ai-origin-lock';
import { createInvitesRouter } from './invites';

export function createWorkspaceSettingsRouter(): Router {
  const router = Router();
  // F71-S05: convites (/api/members/invites/*). Antes do router de membros, para que
  // `/api/members/invites/:id` nunca seja lido como `/api/members/:id`.
  router.use(createInvitesRouter());
  router.use(createWorkspaceRouter());
  // F70-S30: trava de origem da IA (OWNER/ADMIN, auditada).
  router.use(createAiOriginLockRouter());
  return router;
}

export { createWorkspaceRouter } from './workspace';
export { createAiOriginLockRouter } from './ai-origin-lock';
export { createInvitesRouter } from './invites';
