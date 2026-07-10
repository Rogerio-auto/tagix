/**
 * Recompute de métricas de campanha (F56-S02, CAMP-01) — composition root.
 *
 * O bootstrap (F56-S17, dono de `bootstrap/**`+`main.ts`) injeta
 * `{ redis, logger }` e chama `startCampaignRecompute` — espelho exato de
 * `startCampaignWorker` em `../index.ts`:
 *
 * ```ts
 * import { startCampaignRecompute } from '../campaigns/recompute/index';
 * const campaignRecompute = startCampaignRecompute({ redis, logger });
 * // shutdown: await campaignRecompute.stop();
 * ```
 */
import type Redis from 'ioredis';
import type { Logger } from '@hm/logger';
import { createCampaignRecomputePorts } from './db-ports';
import {
  startCampaignRecomputeScheduler,
  type CampaignRecomputeHandle,
  type CampaignRecomputeOptions,
} from './scheduler';

export interface CampaignRecomputeBootDeps {
  readonly redis: Redis;
  readonly logger: Logger;
}

/**
 * Liga o recompute de métricas: monta as ports DB e inicia o scheduler
 * singleton (lock Redis). Retorna o handle para parada limpa no shutdown.
 */
export function startCampaignRecompute(
  deps: CampaignRecomputeBootDeps,
  options: CampaignRecomputeOptions = {},
): CampaignRecomputeHandle {
  const ports = createCampaignRecomputePorts();
  return startCampaignRecomputeScheduler(
    { ports, redis: deps.redis, logger: deps.logger },
    options,
  );
}

export { createCampaignRecomputePorts, TERMINAL_RECOMPUTE_GRACE_MS } from './db-ports';
export {
  computeCampaignMetrics,
  healthStatusOf,
  runCampaignMetricsRecompute,
  type CampaignDeliveryAggregate,
  type CampaignMetricsSnapshot,
  type CampaignRecomputeDeps,
  type CampaignRecomputePorts,
  type RecomputeCampaignRef,
  type RecomputeTickResult,
} from './job';
export {
  campaignRecomputeMsFromEnv,
  runScheduledRecompute,
  startCampaignRecomputeScheduler,
  CAMPAIGN_RECOMPUTE_LOCK_KEY,
  DEFAULT_CAMPAIGN_RECOMPUTE_MS,
  type CampaignRecomputeHandle,
  type CampaignRecomputeOptions,
} from './scheduler';
