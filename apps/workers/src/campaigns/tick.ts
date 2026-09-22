import type { OutboundDecision } from '@hm/shared';
/**
 * Worker-campaigns: tick que conduz o envio (CAMPAIGNS.md 7, 8).
 *
 * Por tick (scheduler 1min, singleton via lock de scheduler):
 *   - lista campanhas RUNNING com next_tick_at vencido (cross-tenant);
 *   - por campanha, runWithDistributedLock(hm:lock:campaign:{id}) (reusa lock.ts):
 *       le quality -> rate adaptativo; RED => auto-pause (return);
 *       fora da send window => reagenda p/ proxima janela (sem enviar);
 *       reaper: devolve claims `sending` estagnados e finaliza recipients sem step;
 *       teto diario (CAMP-06): reset por virada de dia + clamp do batch no saldo;
 *       pega batch de recipients DEVIDOS (next_step_at <= now) e despacha cada um;
 *       dispatch e IDEMPOTENTE: campaign_deliveries.idempotency_key UNIQUE =
 *         sha256(campaignId:recipientId:stepId) -> re-tick NUNCA duplica envio;
 *       drip (CAMP-03): cada dispatch reagenda o recipient p/ o proximo step em
 *         now + delaySeconds (a port faz a transicao na MESMA tx do envio);
 *       terminal (CAMP-04): sem recipients ativos => campanha `completed` e
 *         nextTickAt=null (para o loop infinito de tick a cada 60s).
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

/** Intervalo padrao entre ticks de uma campanha viva. */
export const CAMPAIGN_TICK_INTERVAL_MS = 60000;

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
  /** Outro tick/instancia levou o recipient antes (claim atomico perdido). */
  | { readonly kind: 'skipped' }
  /** Dado do recipient inviabiliza o envio (sem telefone, step sumiu): ja marcado failed. */
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'error'; readonly errorCode?: string };

/** Saldo do teto diario da campanha (CAMP-06). */
export interface CampaignQuota {
  /** Envios ainda permitidos hoje. `null` = sem teto. */
  readonly remaining: number | null;
  /** Proxima virada de dia no fuso da campanha (nextTickAt quando a cota estoura). */
  readonly resetsAt: Date;
}

/** Contadores do reaper de recipients. */
export interface ReapResult {
  /** Claims `sending` estagnados devolvidos a `pending` (ou marcados failed). */
  readonly recovered: number;
  /** Recipients sem proximo step marcados `completed`. */
  readonly finalized: number;
}

/** Ports do tick — injetadas pelo bootstrap, mockadas em teste. */
export interface CampaignTickPorts {
  listDueCampaigns(now: Date): Promise<RunningCampaign[]>;
  fetchQuality(campaign: RunningCampaign): Promise<ChannelHealth>;
  /**
   * Reaper (roda antes do batch): devolve a `pending` os claims `sending` mais
   * velhos que STALE_CLAIM_MS e marca `completed` quem ja consumiu todos os steps.
   * E o que destrava o dado legado do CAMP-03 (recipients presos em `sending`).
   */
  reapRecipients(campaign: RunningCampaign, now: Date): Promise<ReapResult>;
  /** CAMP-06: aplica o reset diario (se virou o dia) e devolve o saldo de envios. */
  ensureDailyQuota(campaign: RunningCampaign, now: Date): Promise<CampaignQuota>;
  /** Recipients DEVIDOS agora (`pending` com next_step_at nulo ou vencido). */
  pendingRecipients(
    campaign: RunningCampaign,
    limit: number,
    now: Date,
  ): Promise<PendingDispatch[]>;
  /**
   * F59-S05 — portao de consentimento, ANTES de enfileirar.
   *
   * Campanha e sempre `marketing`: e o unico produtor que marca assim, e e o que
   * carrega a exigencia de consentimento (AGENCIA_PLAN §4.4). Checar aqui, e nao
   * so no worker outbound, evita enfileirar mil mensagens que serao recusadas
   * uma a uma la na frente.
   */
  checkConsent(
    campaign: RunningCampaign,
    dispatch: PendingDispatch,
    now: Date,
  ): Promise<OutboundDecision>;
  /**
   * F59-S05 — remove o recipient da execucao por supressao/falta de consentimento.
   * Diferente de `invalid` (dado ruim): aqui o dado esta certo e a pessoa
   * simplesmente nao pode receber.
   */
  denyRecipient(
    campaign: RunningCampaign,
    dispatch: PendingDispatch,
    reason: string,
  ): Promise<void>;
  enqueueDelivery(
    campaign: RunningCampaign,
    dispatch: PendingDispatch,
    idempotencyKey: string,
    now: Date,
  ): Promise<DispatchOutcome>;
  /** CAMP-06: contabiliza o que saiu neste tick em `messages_sent_today`. */
  recordDailyUsage(campaign: RunningCampaign, sent: number, now: Date): Promise<void>;
  /**
   * CAMP-04: se a campanha nao tem mais recipients ativos (`pending|sending`),
   * marca `completed` + nextTickAt=null e devolve true.
   */
  settleCampaign(campaign: RunningCampaign, now: Date): Promise<boolean>;
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
  /** Campanhas que atingiram o estado terminal neste tick (CAMP-04). */
  completed: number;
  /** Campanhas que bateram o teto diario e dormiram ate o reset (CAMP-06). */
  quotaExhausted: number;
  /** Recipients marcados failed por dado inviavel. */
  invalid: number;
  /** F59-S05: recipients removidos por supressao/falta de consentimento. */
  denied: number;
  /** F59-S05: recipients adiados por janela horaria (tentam no proximo tick). */
  deferred: number;
}

export interface ProcessCampaignResult {
  dispatched: number;
  duplicates: number;
  invalid: number;
  denied: number;
  deferred: number;
  paused: boolean;
  rescheduled: boolean;
  completed: boolean;
  quotaExhausted: boolean;
}

function emptyResult(): ProcessCampaignResult {
  return {
    dispatched: 0,
    duplicates: 0,
    invalid: 0,
    denied: 0,
    deferred: 0,
    paused: false,
    rescheduled: false,
    completed: false,
    quotaExhausted: false,
  };
}

/** Processa uma campanha sob o lock dela. Retorna contadores parciais. */
export async function processCampaign(
  campaign: RunningCampaign,
  deps: CampaignTickDeps,
  now: Date,
): Promise<ProcessCampaignResult> {
  const { ports, logger } = deps;
  const result = emptyResult();

  const health = await ports.fetchQuality(campaign);
  const rate = effectiveRatePerMinute({
    baseRatePerMinute: campaign.rateLimitPerMinute,
    qualityRating: health.qualityRating,
    deliveryRate: campaign.deliveryRate,
  });

  if (rate === 0) {
    await ports.pauseCampaign(campaign.id, 'quality_red');
    logger.warn('campaigns: auto-pause por quality RED', { campaignId: campaign.id });
    result.paused = true;
    return result;
  }

  if (!isInSendWindow(campaign.sendWindows, now)) {
    const next = nextWindowStart(campaign.sendWindows, now);
    await ports.scheduleNextTick(campaign.id, next);
    result.rescheduled = true;
    return result;
  }

  // Reaper antes do batch: recupera claims estagnados e finaliza quem ja esgotou
  // os steps (inclui o dado legado que o bug CAMP-03 deixou preso em `sending`).
  const reaped = await ports.reapRecipients(campaign, now);
  if (reaped.recovered > 0 || reaped.finalized > 0) {
    logger.info('campaigns: reaper', {
      campaignId: campaign.id,
      recovered: reaped.recovered,
      finalized: reaped.finalized,
    });
  }

  // CAMP-06: teto diario. remaining === 0 => nao envia nada ate a virada do dia.
  const quota = await ports.ensureDailyQuota(campaign, now);
  if (quota.remaining !== null && quota.remaining <= 0) {
    if (await settle(campaign, deps, now, result)) return result;
    await ports.scheduleNextTick(campaign.id, quota.resetsAt);
    result.rescheduled = true;
    result.quotaExhausted = true;
    logger.info('campaigns: teto diario atingido — dormindo ate o reset', {
      campaignId: campaign.id,
      resetsAt: quota.resetsAt.toISOString(),
    });
    return result;
  }

  const rateBatch = batchSizeForTick(rate);
  const limit = quota.remaining === null ? rateBatch : Math.min(rateBatch, quota.remaining);

  const batch = await ports.pendingRecipients(campaign, limit, now);
  for (const d of batch) {
    // F59-S05: o portao corre ANTES do enqueue. Recusa aqui nao vira mensagem
    // na fila, entao nao gasta credito de provider nem polui a metrica de envio.
    const decision = await ports.checkConsent(campaign, d, now);
    if (!decision.allowed) {
      if (decision.reason === 'quiet_hours') {
        // Fora da janela legal no fuso DO CONTATO. Nao descarta: o recipient
        // continua `pending` e o proximo tick tenta de novo — que e exatamente
        // o reagendamento, sem inventar mecanismo novo.
        result.deferred += 1;
        logger.info('campaigns: recipient adiado por janela horaria', {
          campaignId: campaign.id,
          recipientId: d.recipientId,
          timezone: decision.timezone,
          retryAt: decision.retryAt?.toISOString(),
        });
        continue;
      }
      // Supressao ou falta de consentimento nao se resolve com o tempo:
      // remove da execucao para nao tentar para sempre.
      result.denied += 1;
      await ports.denyRecipient(campaign, d, decision.reason);
      logger.warn('campaigns: recipient removido pelo portao de consentimento', {
        campaignId: campaign.id,
        recipientId: d.recipientId,
        reason: decision.reason,
      });
      continue;
    }

    const key = deliveryIdempotencyKey(campaign.id, d.recipientId, d.stepId);
    const outcome = await ports.enqueueDelivery(campaign, d, key, now);
    switch (outcome.kind) {
      case 'enqueued':
        result.dispatched += 1;
        break;
      case 'duplicate':
        result.duplicates += 1;
        break;
      case 'invalid':
        result.invalid += 1;
        logger.warn('campaigns: recipient inviavel', {
          campaignId: campaign.id,
          recipientId: d.recipientId,
          reason: outcome.reason,
        });
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
          result.paused = true;
          return result;
        }
        break;
      }
      case 'skipped':
      case 'no_step':
        break;
    }
  }

  if (result.dispatched > 0) {
    await ports.recordDailyUsage(campaign, result.dispatched, now);
  }

  // CAMP-04: fim de linha? entao a campanha nao volta a ser agendada.
  if (await settle(campaign, deps, now, result)) return result;

  await ports.scheduleNextTick(campaign.id, new Date(now.getTime() + CAMPAIGN_TICK_INTERVAL_MS));
  result.rescheduled = true;
  return result;
}

/** Tenta fechar a campanha (estado terminal). true = fechou. */
async function settle(
  campaign: RunningCampaign,
  deps: CampaignTickDeps,
  now: Date,
  result: ProcessCampaignResult,
): Promise<boolean> {
  const done = await deps.ports.settleCampaign(campaign, now);
  if (!done) return false;
  result.completed = true;
  deps.logger.info('campaigns: campanha concluida', { campaignId: campaign.id });
  return true;
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
    completed: 0,
    quotaExhausted: 0,
    invalid: 0,
    denied: 0,
    deferred: 0,
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
          result.invalid += r.invalid;
          if (r.paused) result.paused += 1;
          if (r.rescheduled) result.rescheduled += 1;
          if (r.completed) result.completed += 1;
          if (r.quotaExhausted) result.quotaExhausted += 1;
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
