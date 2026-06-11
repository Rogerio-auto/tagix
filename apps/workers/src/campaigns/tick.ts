/**
 * Worker-campaigns: tick que conduz o envio (CAMPAIGNS.md 7, 8).
 *
 * Por tick (scheduler 1min, singleton via lock de scheduler):
 *   - lista campanhas RUNNING com next_tick_at vencido (cross-tenant);
 *   - por campanha, runWithDistributedLock(hm:lock:campaign:{id}) (reusa lock.ts):
 *       le quality -> rate adaptativo; RED => auto-pause (return);
 *       fora da send window => reagenda p/ proxima janela (sem enviar);
 *       pega batch de recipients pending (~rate/4) e despacha cada um;
 *       dispatch e IDEMPOTENTE: campaign_deliveries.idempotency_key UNIQUE =
 *         sha256(campaignId:recipientId:stepId) -> re-tick NUNCA duplica envio.
 *
 * Tudo via PORTS injetadas (DB/Graph/MQ) — testavel sem WABA nem broker reais.
 * O envio real do template reusa o pipeline outbound F1-S07 (a port enqueueDelivery
 * persiste a mensagem pending + cria o delivery + publica em hm.q.outbound).
 */
import { createHash } from 'node:crypto';
import { runWithDistributedLock } from '../lock';
import type { Logger } from '@hm/logger';
import type { ChannelHealth } from '@hm/channels';
import { mapCampaignError, type CampaignErrorAction } from '@hm/channels';
import { effectiveRatePerMinute, batchSizeForTick } from './rate';
import { isInSendWindow, nextWindowStart, type SendWindows } from './windows';

/** TTL do lock por campanha (cobre um tick com folga). */
export const CAMPAIGN_LOCK_TTL_MS = 50000;

/** Idempotency key canonica de uma delivery (UNIQUE no schema). */
export function deliveryIdempotencyKey(
  campaignId: string,
  recipientId: string,
  stepId: string,
): string {
  return createHash('sha256')
    .update(`${campaignId}:${recipientId}:${stepId}`)
    .digest('hex');
}

/** Snapshot minimo de campanha RUNNING para o tick. */
export interface RunningCampaign {
  readonly id: string;
  readonly workspaceId: string;
  readonly channelId: string;
  readonly sendWindows: SendWindows | null;
  readonly rateLimitPerMinute: number;
  readonly deliveryRate: number | null;
}

/** Recipient pendente + o proximo step a enviar. */
export interface PendingDispatch {
  readonly recipientId: string;
  readonly contactId: string;
  readonly stepId: string;
  readonly stepIndex: number;
}

/** Resultado do envio de uma delivery (do ponto de vista da port). */
export type DispatchOutcome =
  | { readonly kind: 'enqueued' }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'no_step' }
  | { readonly kind: 'error'; readonly errorCode?: string };

/** Ports do tick — injetadas pelo bootstrap, mockadas em teste. */
export interface CampaignTickPorts {
  listDueCampaigns(now: Date): Promise<RunningCampaign[]>;
  fetchQuality(campaign: RunningCampaign): Promise<ChannelHealth>;
  pendingRecipients(campaign: RunningCampaign, limit: number): Promise<PendingDispatch[]>;
  enqueueDelivery(
    campaign: RunningCampaign,
    dispatch: PendingDispatch,
    idempotencyKey: string,
  ): Promise<DispatchOutcome>;
  pauseCampaign(campaignId: string, reason: string): Promise<void>;
  scheduleNextTick(campaignId: string, at: Date): Promise<void>;
  applyErrorAction(
    campaign: RunningCampaign,
    dispatch: PendingDispatch,
    action: CampaignErrorAction,
  ): Promise<void>;
}

export interface CampaignTickDeps {
  readonly ports: CampaignTickPorts;
  readonly logger: Logger;
}

export interface CampaignTickOptions {
  readonly now?: Date;
}

export interface CampaignTickResult {
  campaigns: number;
  dispatched: number;
  duplicates: number;
  paused: number;
  rescheduled: number;
}

/** Processa uma campanha sob o lock dela. Retorna contadores parciais. */
export async function processCampaign(
  campaign: RunningCampaign,
  deps: CampaignTickDeps,
  now: Date,
): Promise<{ dispatched: number; duplicates: number; paused: boolean; rescheduled: boolean }> {
  const { ports, logger } = deps;
  let dispatched = 0;
  let duplicates = 0;

  const health = await ports.fetchQuality(campaign);
  const rate = effectiveRatePerMinute({
    baseRatePerMinute: campaign.rateLimitPerMinute,
    qualityRating: health.qualityRating,
    deliveryRate: campaign.deliveryRate,
  });

  if (rate === 0) {
    await ports.pauseCampaign(campaign.id, 'quality_red');
    logger.warn('campaigns: auto-pause por quality RED', { campaignId: campaign.id });
    return { dispatched, duplicates, paused: true, rescheduled: false };
  }

  if (!isInSendWindow(campaign.sendWindows, now)) {
    const next = nextWindowStart(campaign.sendWindows, now);
    await ports.scheduleNextTick(campaign.id, next);
    return { dispatched, duplicates, paused: false, rescheduled: true };
  }

  const batch = await ports.pendingRecipients(campaign, batchSizeForTick(rate));
  for (const d of batch) {
    const key = deliveryIdempotencyKey(campaign.id, d.recipientId, d.stepId);
    const outcome = await ports.enqueueDelivery(campaign, d, key);
    switch (outcome.kind) {
      case 'enqueued':
        dispatched += 1;
        break;
      case 'duplicate':
        duplicates += 1;
        break;
      case 'error': {
        const info = mapCampaignError(outcome.errorCode);
        await ports.applyErrorAction(campaign, d, info.action);
        if (info.action.kind === 'pause_campaign') {
          await ports.pauseCampaign(campaign.id, info.action.reason);
          logger.warn('campaigns: auto-pause por error code', {
            campaignId: campaign.id,
            errorCode: outcome.errorCode,
          });
          return { dispatched, duplicates, paused: true, rescheduled: false };
        }
        break;
      }
      case 'no_step':
        break;
    }
  }

  const nextTick = new Date(now.getTime() + 60000);
  await ports.scheduleNextTick(campaign.id, nextTick);
  return { dispatched, duplicates, paused: false, rescheduled: true };
}

/**
 * Executa um tick: lista campanhas vencidas e processa cada uma sob o lock
 * distribuido por campanha (serializa ticks concorrentes da mesma campanha).
 */
export async function runCampaignTick(
  deps: CampaignTickDeps,
  options: CampaignTickOptions = {},
): Promise<CampaignTickResult> {
  const now = options.now ?? new Date();
  const due = await deps.ports.listDueCampaigns(now);

  const result: CampaignTickResult = {
    campaigns: due.length,
    dispatched: 0,
    duplicates: 0,
    paused: 0,
    rescheduled: 0,
  };

  for (const campaign of due) {
    try {
      await runWithDistributedLock(
        `hm:lock:campaign:${campaign.id}`,
        CAMPAIGN_LOCK_TTL_MS,
        async () => {
          const r = await processCampaign(campaign, deps, now);
          result.dispatched += r.dispatched;
          result.duplicates += r.duplicates;
          if (r.paused) result.paused += 1;
          if (r.rescheduled) result.rescheduled += 1;
        },
      );
    } catch (err: unknown) {
      deps.logger.error('campaigns: tick de campanha falhou', {
        campaignId: campaign.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  deps.logger.info('campaigns: tick concluido', { ...result });
  return result;
}
