import type { OutboundDecision } from '@hm/shared';
/**
 * Worker-campaigns: tick que conduz o envio (CAMPAIGNS.md 7, 8).
 *
 * Por tick (scheduler a cada ~5s, singleton via lock Redis renovado):
 *   - PROMOVE `scheduled -> running` as campanhas com start_at vencido (UPDATE
 *     condicional unico: duas instancias nunca promovem a mesma duas vezes);
 *   - lista campanhas RUNNING com next_tick_at vencido (cross-tenant);
 *   - por campanha, runWithDistributedLock(hm:lock:campaign:{id}):
 *       prazo final (end_at) vencido => fecha `completed` com motivo gravado;
 *       canal desativado/sem credencial/credencial recusada => pausa com orientacao
 *         (NUNCA completa recipients por isso);
 *       quality -> rate adaptativo; YELLOW reduz o ritmo; RED pausa ANTES de enviar;
 *       fora da send window => reagenda p/ proxima janela (sem enviar);
 *       reaper: devolve claims `sending` estagnados e finaliza recipients sem step;
 *       teto diario (CAMP-06) le o saldo p/ dimensionar o lote / dormir ate o reset;
 *       compasso (F58-S11): lote = creditos do balde (GCRA, cursor = next_tick_at);
 *       cada dispatch RESERVA ritmo + cota na mesma transacao da entrega, sob lock
 *         de linha da campanha — teto e ritmo valem mesmo com duas instancias;
 *       dispatch e IDEMPOTENTE: campaign_deliveries.idempotency_key UNIQUE;
 *       drip (CAMP-03): cada dispatch reagenda o recipient p/ o proximo step;
 *       terminal (CAMP-04): sem recipients ativos => `completed` + nextTickAt=null.
 *
 * Tudo via PORTS injetadas (DB/Graph/MQ) — testavel sem WABA nem broker reais, com
 * relogio deterministico (`now` sempre por parametro).
 */
import { createHash } from 'node:crypto';
import { runWithDistributedLock } from '../lock';
import type { Logger } from '@hm/logger';
import type { ChannelHealth } from '@hm/channels';
import { mapCampaignError, type CampaignErrorAction } from '@hm/channels';
import {
  DEFAULT_PACING_WINDOW_MS,
  effectiveRatePerMinute,
  planPace,
  type DispatchGateReason,
} from './rate';
import { isInSendWindow, nextWindowStart, type SendWindows } from './windows';
import {
  recordSubscriptionSkip,
  SKIPPED_SUBSCRIPTION_INACTIVE,
  type SubscriptionGateDecision,
} from '../lib/subscription-gate';

/**
 * TTL do lock por campanha. A secao critica e CURTA por construcao: um lote e no
 * maximo `burst` mensagens (~5s de ritmo), cada uma uma transacao curta.
 */
export const CAMPAIGN_LOCK_TTL_MS = 30000;

/** Intervalo ate a proxima olhada quando nao ha nada devido agora. */
export const CAMPAIGN_TICK_INTERVAL_MS = 60000;

/** Espera antes de tentar de novo quando a Meta nao respondeu (falha transitoria). */
export const CHANNEL_UNAVAILABLE_RETRY_MS = 60000;

/** Idempotency key canonica de uma delivery (UNIQUE no schema). */
export function deliveryIdempotencyKey(
  campaignId: string,
  recipientId: string,
  stepId: string,
): string {
  return createHash('sha256').update(`${campaignId}:${recipientId}:${stepId}`).digest('hex');
}

// ─── Motivos observaveis de parada ───────────────────────────────────────────

/**
 * Motivo de pausa/encerramento + orientacao ao cliente. Gravado em `audit_logs`
 * (action `campaign.paused` / `campaign.completed`, metadata `{ reason, message }`)
 * e devolvido pela API no detalhe da campanha — a tela explica o que aconteceu
 * e o que fazer, em vez de a campanha "sumir" da fila.
 */
const STOP_GUIDANCE: Readonly<Record<string, string>> = {
  quality_red:
    'A qualidade do número no WhatsApp ficou vermelha. Pausamos para proteger o número. Retome quando a qualidade voltar ao amarelo ou verde.',
  channel_inactive:
    'O canal desta campanha está desativado. Reative-o em Canais e retome a campanha.',
  channel_not_found:
    'O canal desta campanha não existe mais. Duplique a campanha escolhendo outro canal.',
  channel_credentials_missing:
    'O canal está sem as credenciais da Meta. Reconecte o número em Canais e retome a campanha.',
  channel_credentials_invalid:
    'A Meta recusou as credenciais do canal (acesso expirado ou sem permissão). Reconecte o número em Canais e retome a campanha.',
  [SKIPPED_SUBSCRIPTION_INACTIVE]:
    'A assinatura da empresa não está ativa. Regularize o plano e retome a campanha.',
  template_disabled:
    'A Meta pausou ou desativou o modelo de mensagem. Escolha outro modelo aprovado e retome.',
  rate_limit: 'A Meta limitou o ritmo de envio deste número. Aguarde alguns minutos e retome.',
  end_at_reached:
    'O prazo final da campanha chegou. Quem ainda não tinha recebido a mensagem ficou de fora.',
  all_recipients_done: 'Todos os destinatários foram processados.',
  manual: 'Pausada manualmente.',
};

/** Orientacao legivel para um motivo de parada (fallback generico, nunca vazio). */
export function describeStopReason(reason: string): string {
  return (
    STOP_GUIDANCE[reason] ??
    'A campanha foi interrompida automaticamente. Revise o canal e o modelo antes de retomar.'
  );
}

// ─── Contratos ───────────────────────────────────────────────────────────────

/** Snapshot minimo de campanha RUNNING para o tick. */
export interface RunningCampaign {
  readonly id: string;
  readonly workspaceId: string;
  readonly channelId: string;
  readonly sendWindows: SendWindows | null;
  readonly rateLimitPerMinute: number;
  readonly deliveryRate: number | null;
  /** Prazo final: nenhum envio a partir daqui; a campanha fecha com motivo. */
  readonly endAt: Date | null;
  /** Cursor do compasso (= next_tick_at). `null` = balde cheio. */
  readonly nextTickAt: Date | null;
}

/** Campanha promovida `scheduled -> running` neste tick. */
export interface PromotedCampaign {
  readonly id: string;
  readonly workspaceId: string;
  readonly startAt: Date;
}

/** Recipient pendente + o proximo step a enviar. */
export interface PendingDispatch {
  readonly recipientId: string;
  readonly contactId: string;
  readonly stepId: string;
  readonly stepIndex: number;
}

/** Ritmo aplicado na reserva atomica de cada dispatch. */
export interface DispatchPacing {
  readonly ratePerMinute: number;
  readonly windowMs: number;
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
  /**
   * F58-S11: o portao da campanha (status/prazo/teto/compasso), avaliado sob lock
   * de linha, recusou ESTA mensagem. Nada foi gravado (rollback); o lote para.
   */
  | {
      readonly kind: 'gate_closed';
      readonly reason: DispatchGateReason;
      readonly retryAt: Date | null;
    }
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

/** Motivos de canal que PAUSAM a campanha (precisam de acao humana). */
export type ChannelBlockReason =
  | 'channel_inactive'
  | 'channel_not_found'
  | 'channel_credentials_missing'
  | 'channel_credentials_invalid';

/** Estado do canal antes de enviar. */
export type ChannelInspection =
  | { readonly kind: 'ready'; readonly health: ChannelHealth }
  | { readonly kind: 'blocked'; readonly reason: ChannelBlockReason }
  /** Meta fora do ar/timeout: nao e culpa do cliente; tenta de novo mais tarde. */
  | { readonly kind: 'unavailable'; readonly detail: string };

/** Desfecho do encerramento por prazo. */
export interface CloseResult {
  /** true se ESTA chamada fechou a campanha (false = ja nao estava running). */
  readonly closed: boolean;
  /** Recipients que ficaram de fora (marcados failed `campaign_end_reached`). */
  readonly notReached: number;
}

/** Ports do tick — injetadas pelo bootstrap, mockadas em teste. */
export interface CampaignTickPorts {
  /**
   * F58-S11: `scheduled -> running` para start_at <= now, num UPDATE condicional
   * (atomico entre instancias) + registro do motivo. Devolve as promovidas.
   */
  promoteScheduledCampaigns(now: Date): Promise<PromotedCampaign[]>;
  listDueCampaigns(now: Date): Promise<RunningCampaign[]>;
  /**
   * F71-S06 — a empresa da campanha pode disparar AGORA? Lido do banco a cada tick da
   * campanha (sem cache): `expired`/`canceled`/trial vencido → nada sai.
   */
  checkSubscription(campaign: RunningCampaign): Promise<SubscriptionGateDecision>;
  /** F58-S11: canal ativo + credencial valida + quality (cacheada) numa leitura so. */
  inspectChannel(campaign: RunningCampaign): Promise<ChannelInspection>;
  /**
   * Reaper (roda antes do batch): devolve a `pending` os claims `sending` mais
   * velhos que STALE_CLAIM_MS e marca `completed` quem ja consumiu todos os steps.
   */
  reapRecipients(campaign: RunningCampaign, now: Date): Promise<ReapResult>;
  /**
   * CAMP-06: saldo do teto diario (SOMENTE leitura — o reset e a contagem acontecem
   * atomicamente na reserva de cada dispatch). Usado para dimensionar o lote e
   * saber ate quando dormir.
   */
  ensureDailyQuota(campaign: RunningCampaign, now: Date): Promise<CampaignQuota>;
  /** Recipients DEVIDOS agora (`pending` com next_step_at nulo ou vencido). */
  pendingRecipients(
    campaign: RunningCampaign,
    limit: number,
    now: Date,
  ): Promise<PendingDispatch[]>;
  /**
   * F59-S05 — portao de consentimento, ANTES de enfileirar. Campanha e sempre
   * `marketing`.
   */
  checkConsent(
    campaign: RunningCampaign,
    dispatch: PendingDispatch,
    now: Date,
  ): Promise<OutboundDecision>;
  /** F59-S05 — remove o recipient da execucao por supressao/falta de consentimento. */
  denyRecipient(
    campaign: RunningCampaign,
    dispatch: PendingDispatch,
    reason: string,
  ): Promise<void>;
  /**
   * F58-S11 — adia o recipient (janela horaria do contato) para `until`, sem
   * descartar: ele sai da frente da fila e nao trava o lote dos demais.
   */
  deferRecipient(campaign: RunningCampaign, dispatch: PendingDispatch, until: Date): Promise<void>;
  /**
   * Dispatch transacional: reserva compasso + cota (lock de linha da campanha),
   * claim do recipient, delivery idempotente, mensagem, drip e outbox — tudo ou nada.
   */
  enqueueDelivery(
    campaign: RunningCampaign,
    dispatch: PendingDispatch,
    idempotencyKey: string,
    now: Date,
    pacing: DispatchPacing,
  ): Promise<DispatchOutcome>;
  /**
   * CAMP-04: se a campanha nao tem mais recipients ativos (`pending|sending`),
   * marca `completed` + nextTickAt=null e devolve true.
   */
  settleCampaign(campaign: RunningCampaign, now: Date): Promise<boolean>;
  /** F58-S11: encerra por prazo final (end_at), registrando o motivo. */
  closeCampaign(
    campaign: RunningCampaign,
    reason: 'end_at_reached',
    now: Date,
  ): Promise<CloseResult>;
  /** Pausa (so se `running`) e grava o motivo + orientacao. */
  pauseCampaign(campaignId: string, reason: string): Promise<void>;
  /**
   * Agenda a proxima olhada. A port NUNCA antecipa o cursor do compasso
   * (greatest) e NUNCA passa do end_at (least) — o prazo fecha na hora.
   */
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
  /** Janela de compasso (≈ intervalo do scheduler). Default 5s. */
  readonly pacingWindowMs?: number;
  /**
   * Sinal de perda de lideranca (lock do scheduler nao renovou). Abortado = nao
   * comeca campanha nova nem mensagem nova; o que ja foi gravado e consistente.
   */
  readonly signal?: AbortSignal;
}

export interface CampaignTickResult {
  campaigns: number;
  /** F58-S11: campanhas agendadas que comecaram neste tick. */
  promoted: number;
  dispatched: number;
  duplicates: number;
  paused: number;
  rescheduled: number;
  /** Campanhas que atingiram o estado terminal neste tick (CAMP-04). */
  completed: number;
  /** F58-S11: campanhas fechadas pelo prazo final. */
  ended: number;
  /** Campanhas que bateram o teto diario e dormiram ate o reset (CAMP-06). */
  quotaExhausted: number;
  /** Recipients marcados failed por dado inviavel. */
  invalid: number;
  /** F59-S05: recipients removidos por supressao/falta de consentimento. */
  denied: number;
  /** F59-S05: recipients adiados por janela horaria. */
  deferred: number;
  /** F71-S06: campanhas pausadas por assinatura inativa (nada enviado). */
  subscriptionInactive: number;
  /** F58-S11: campanhas pausadas por canal desativado/credencial. */
  channelBlocked: number;
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
  /** F58-S11: fechada pelo prazo final. */
  ended: boolean;
  quotaExhausted: boolean;
  /** F71-S06: pausada porque a assinatura da empresa esta inativa. */
  subscriptionInactive: boolean;
  /** F58-S11: pausada por canal desativado/credencial. */
  channelBlocked: boolean;
  /** Rate efetivo aplicado neste tick (0 = nao chegou a calcular / RED). */
  ratePerMinute: number;
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
    ended: false,
    quotaExhausted: false,
    subscriptionInactive: false,
    channelBlocked: false,
    ratePerMinute: 0,
  };
}

export interface ProcessCampaignOptions {
  readonly pacingWindowMs?: number;
  readonly signal?: AbortSignal;
}

/** Fecha por prazo final e preenche o resultado. */
async function closeForDeadline(
  campaign: RunningCampaign,
  deps: CampaignTickDeps,
  now: Date,
  result: ProcessCampaignResult,
): Promise<ProcessCampaignResult> {
  const closed = await deps.ports.closeCampaign(campaign, 'end_at_reached', now);
  result.ended = closed.closed;
  result.completed = closed.closed;
  deps.logger.info('campaigns: prazo final atingido — campanha encerrada', {
    campaignId: campaign.id,
    endAt: campaign.endAt?.toISOString() ?? null,
    notReached: closed.notReached,
    closedNow: closed.closed,
  });
  return result;
}

/** Processa uma campanha sob o lock dela. Retorna contadores parciais. */
export async function processCampaign(
  campaign: RunningCampaign,
  deps: CampaignTickDeps,
  now: Date,
  options: ProcessCampaignOptions = {},
): Promise<ProcessCampaignResult> {
  const { ports, logger } = deps;
  const result = emptyResult();
  const windowMs = options.pacingWindowMs ?? DEFAULT_PACING_WINDOW_MS;

  // F71-S06: empresa sem assinatura ativa nao dispara. Primeiro de tudo (nem consulta a
  // Meta). A campanha vai para `paused` (sai do loop de tick e fica visivel na UI).
  const subscription = await ports.checkSubscription(campaign);
  if (!subscription.active) {
    await ports.pauseCampaign(campaign.id, SKIPPED_SUBSCRIPTION_INACTIVE);
    recordSubscriptionSkip(logger, 'campaign-tick', campaign.workspaceId, subscription.status, {
      campaignId: campaign.id,
    });
    result.paused = true;
    result.subscriptionInactive = true;
    return result;
  }

  // F58-S11: prazo final vencido fecha ANTES de olhar canal/Meta — nada sai depois dele.
  if (campaign.endAt !== null && campaign.endAt.getTime() <= now.getTime()) {
    return closeForDeadline(campaign, deps, now, result);
  }

  // F58-S11: canal desativado ou credencial invalida PAUSA com orientacao. Antes, o
  // tick seguia "enviando" e o outbound falhava um a um — recipients iam a `failed`
  // e a campanha chegava a `completed` sem que ninguem tivesse recebido nada.
  const channel = await ports.inspectChannel(campaign);
  if (channel.kind === 'blocked') {
    await ports.pauseCampaign(campaign.id, channel.reason);
    logger.warn('campaigns: auto-pause por canal indisponivel', {
      campaignId: campaign.id,
      reason: channel.reason,
    });
    result.paused = true;
    result.channelBlocked = true;
    return result;
  }
  if (channel.kind === 'unavailable') {
    await ports.scheduleNextTick(
      campaign.id,
      new Date(now.getTime() + CHANNEL_UNAVAILABLE_RETRY_MS),
    );
    logger.warn('campaigns: Meta indisponivel — sem envio neste tick', {
      campaignId: campaign.id,
      detail: channel.detail,
    });
    result.rescheduled = true;
    return result;
  }

  const health = channel.health;
  const rate = effectiveRatePerMinute({
    baseRatePerMinute: campaign.rateLimitPerMinute,
    qualityRating: health.qualityRating,
    deliveryRate: campaign.deliveryRate,
  });
  result.ratePerMinute = rate;

  if (rate === 0) {
    await ports.pauseCampaign(campaign.id, 'quality_red');
    logger.warn('campaigns: auto-pause por quality RED', { campaignId: campaign.id });
    result.paused = true;
    return result;
  }
  if (rate < campaign.rateLimitPerMinute) {
    logger.info('campaigns: ritmo reduzido', {
      campaignId: campaign.id,
      configured: campaign.rateLimitPerMinute,
      effective: rate,
      quality: health.qualityRating,
      deliveryRate: campaign.deliveryRate,
    });
  }

  if (!isInSendWindow(campaign.sendWindows, now)) {
    const next = nextWindowStart(campaign.sendWindows, now);
    await ports.scheduleNextTick(campaign.id, next);
    result.rescheduled = true;
    return result;
  }

  // Reaper antes do batch: recupera claims estagnados e finaliza quem ja esgotou os steps.
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
    return sleepUntilQuotaReset(campaign, deps, now, quota.resetsAt, result);
  }

  // F58-S11: lote = creditos do balde (GCRA). O cursor duravel e next_tick_at.
  const pace = planPace({ ratePerMinute: rate, cursor: campaign.nextTickAt, now, windowMs });
  if (pace.credits <= 0) {
    await ports.scheduleNextTick(campaign.id, pace.effectiveCursor);
    result.rescheduled = true;
    return result;
  }
  const limit = quota.remaining === null ? pace.credits : Math.min(pace.credits, quota.remaining);
  const pacing: DispatchPacing = { ratePerMinute: rate, windowMs };

  const batch = await ports.pendingRecipients(campaign, limit, now);
  let gate: { readonly reason: DispatchGateReason; readonly retryAt: Date | null } | null = null;

  for (const d of batch) {
    if (options.signal?.aborted) {
      logger.warn('campaigns: lideranca perdida — lote interrompido', { campaignId: campaign.id });
      return result;
    }
    // F59-S05: o portao de consentimento corre ANTES do enqueue.
    const decision = await ports.checkConsent(campaign, d, now);
    if (!decision.allowed) {
      if (decision.reason === 'quiet_hours') {
        result.deferred += 1;
        // Sai da frente da fila ate a janela do contato abrir: nao trava o lote.
        if (decision.retryAt) await ports.deferRecipient(campaign, d, decision.retryAt);
        logger.info('campaigns: recipient adiado por janela horaria', {
          campaignId: campaign.id,
          recipientId: d.recipientId,
          timezone: decision.timezone,
          retryAt: decision.retryAt?.toISOString(),
        });
        continue;
      }
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
    const outcome = await ports.enqueueDelivery(campaign, d, key, now, pacing);
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
      case 'gate_closed':
        gate = { reason: outcome.reason, retryAt: outcome.retryAt };
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
    if (gate !== null) break;
  }

  if (gate !== null) {
    switch (gate.reason) {
      case 'not_running':
        // Pausada/cancelada no meio do lote (por pessoa ou outra instancia): quem
        // mudou o status e dono do agendamento agora. Nao reagenda.
        logger.info('campaigns: campanha saiu de running durante o lote', {
          campaignId: campaign.id,
        });
        return result;
      case 'ended':
        return closeForDeadline(campaign, deps, now, result);
      case 'daily_quota':
        return sleepUntilQuotaReset(campaign, deps, now, gate.retryAt ?? quota.resetsAt, result);
      case 'pace':
        // Balde vazio: o cursor ja esta gravado; a port respeita o cursor (greatest).
        await ports.scheduleNextTick(campaign.id, gate.retryAt ?? now);
        result.rescheduled = true;
        return result;
    }
  }

  // CAMP-04: fim de linha? entao a campanha nao volta a ser agendada.
  if (await settle(campaign, deps, now, result)) return result;

  // Lote cheio = provavelmente ha mais devidos: volta assim que o compasso deixar
  // (a port nunca agenda antes do cursor). Lote parcial = esgotou os devidos de agora.
  const moreDue = batch.length >= limit;
  const next = moreDue ? now : new Date(now.getTime() + CAMPAIGN_TICK_INTERVAL_MS);
  await ports.scheduleNextTick(campaign.id, next);
  result.rescheduled = true;
  return result;
}

/** Teto diario esgotado: fecha se ja acabou; senao dorme ate a virada do dia. */
async function sleepUntilQuotaReset(
  campaign: RunningCampaign,
  deps: CampaignTickDeps,
  now: Date,
  resetsAt: Date,
  result: ProcessCampaignResult,
): Promise<ProcessCampaignResult> {
  if (await settle(campaign, deps, now, result)) return result;
  await deps.ports.scheduleNextTick(campaign.id, resetsAt);
  result.rescheduled = true;
  result.quotaExhausted = true;
  deps.logger.info('campaigns: teto diario atingido — dormindo ate o reset', {
    campaignId: campaign.id,
    resetsAt: resetsAt.toISOString(),
  });
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
 * Executa um tick: promove as agendadas vencidas, lista campanhas devidas e
 * processa cada uma sob o lock por campanha.
 */
export async function runCampaignTick(
  deps: CampaignTickDeps,
  options: CampaignTickOptions = {},
): Promise<CampaignTickResult> {
  const now = options.now ?? new Date();

  const result: CampaignTickResult = {
    campaigns: 0,
    promoted: 0,
    dispatched: 0,
    duplicates: 0,
    paused: 0,
    rescheduled: 0,
    completed: 0,
    ended: 0,
    quotaExhausted: 0,
    invalid: 0,
    denied: 0,
    deferred: 0,
    subscriptionInactive: 0,
    channelBlocked: 0,
  };

  const promoted = await deps.ports.promoteScheduledCampaigns(now);
  result.promoted = promoted.length;
  for (const p of promoted) {
    deps.logger.info('campaigns: agendamento venceu — campanha iniciada', {
      campaignId: p.id,
      workspaceId: p.workspaceId,
      startAt: p.startAt.toISOString(),
    });
  }

  const due = await deps.ports.listDueCampaigns(now);
  result.campaigns = due.length;

  for (const campaign of due) {
    if (options.signal?.aborted) {
      deps.logger.warn('campaigns: lideranca perdida — tick interrompido');
      break;
    }
    try {
      await runWithDistributedLock(
        `hm:lock:campaign:${campaign.id}`,
        CAMPAIGN_LOCK_TTL_MS,
        async () => {
          const r = await processCampaign(campaign, deps, now, {
            pacingWindowMs: options.pacingWindowMs,
            signal: options.signal,
          });
          result.dispatched += r.dispatched;
          result.duplicates += r.duplicates;
          result.invalid += r.invalid;
          result.denied += r.denied;
          result.deferred += r.deferred;
          if (r.paused) result.paused += 1;
          if (r.rescheduled) result.rescheduled += 1;
          if (r.completed) result.completed += 1;
          if (r.ended) result.ended += 1;
          if (r.quotaExhausted) result.quotaExhausted += 1;
          if (r.subscriptionInactive) result.subscriptionInactive += 1;
          if (r.channelBlocked) result.channelBlocked += 1;
        },
      );
    } catch (err: unknown) {
      deps.logger.error('campaigns: tick de campanha falhou', {
        campaignId: campaign.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Varredura a cada ~5s: tick vazio vai para debug para nao afogar o log.
  if (result.campaigns > 0 || result.promoted > 0) {
    deps.logger.info('campaigns: tick concluido', { ...result });
  } else {
    deps.logger.debug('campaigns: tick sem campanhas devidas');
  }
  return result;
}
