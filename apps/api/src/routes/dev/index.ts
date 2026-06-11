/**
 * Barrel das rotas de gestão Dev (F9-S04): API keys + webhooks outbound.
 *
 * `createDevRouter()` compõe os dois sub-routers para um único `app.use(...)` no
 * `app.ts` (gap-fill). Tudo session-authed (requireAuth/requireRole), consumido pela
 * página Settings → Dev (F9-S06).
 */
import { Router } from 'express';
import { createDevApiKeysRouter } from './api-keys';
import { createDevWebhooksRouter } from './webhooks';

export { createDevApiKeysRouter } from './api-keys';
export { createDevWebhooksRouter, WEBHOOK_EVENTS } from './webhooks';

/** Router único com todas as rotas `/api/dev/*`. */
export function createDevRouter(): Router {
  const router = Router();
  router.use(createDevApiKeysRouter());
  router.use(createDevWebhooksRouter());
  return router;
}
