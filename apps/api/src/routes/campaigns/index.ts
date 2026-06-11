/**
 * Agregador das rotas do dominio Campaigns (CAMPAIGNS.md 13). Montado em app.ts
 * pelo orchestrator. recipients/opt-in (F6-S04) sao montados a parte (outro slot).
 */
import { Router } from 'express';
import { createCampaignsCrudRouter } from './crud';
import { createCampaignsLifecycleRouter } from './lifecycle';
import { createCampaignsMetricsRouter } from './metrics';

export function createCampaignsRouter(): Router {
  const router = Router();
  router.use(createCampaignsLifecycleRouter());
  router.use(createCampaignsMetricsRouter());
  router.use(createCampaignsCrudRouter());
  return router;
}

export { validateCampaign } from './validate';
export type {
  ValidationResult,
  ValidationCampaign,
  ValidationGraphPorts,
} from './validate';
export {
  loadCampaignChannel,
  buildValidationCampaign,
  makeGraphPorts,
} from './service';
