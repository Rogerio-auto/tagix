/**
 * Worker-campaigns (F6-S05): tick que conduz o envio das campanhas RUNNING.
 * Composition root self-contained: o bootstrap injeta { channel, redis, logger }
 * e chama startCampaignScheduler. Exporta a fabrica de ports + os pure helpers.
 */
import type Redis from 'ioredis';
import type { Logger } from '@hm/logger';
import type { MqHandle } from '@hm/shared/mq';
import { createCampaignTickPorts } from './db-ports';
import {
  startCampaignScheduler,
  type CampaignSchedulerHandle,
  type CampaignSchedulerOptions,
} from './scheduler';

type MqChannel = MqHandle['channel'];

export interface CampaignWorkerBootDeps {
  readonly channel: MqChannel;
  readonly redis: Redis;
  readonly logger: Logger;
}

/**
 * Liga o worker-campaigns: monta as ports (DB/Graph/MQ) e inicia o scheduler
 * singleton. Retorna o handle para parada limpa no shutdown.
 */
export function startCampaignWorker(
  deps: CampaignWorkerBootDeps,
  options: CampaignSchedulerOptions = {},
): CampaignSchedulerHandle {
  const ports = createCampaignTickPorts({ channel: deps.channel, logger: deps.logger });
  return startCampaignScheduler(
    { ports, redis: deps.redis, logger: deps.logger },
    options,
  );
}

export { createCampaignTickPorts } from './db-ports';
export {
  runCampaignTick,
  processCampaign,
  deliveryIdempotencyKey,
  type CampaignTickPorts,
  type CampaignTickDeps,
  type RunningCampaign,
  type PendingDispatch,
  type DispatchOutcome,
} from './tick';
export {
  startCampaignScheduler,
  runScheduledCampaignTick,
  campaignTickMsFromEnv,
  type CampaignSchedulerHandle,
} from './scheduler';
export { effectiveRatePerMinute, batchSizeForTick } from './rate';
export { isInSendWindow, nextWindowStart } from './windows';
