/**
 * Recompute de métricas de campanha (F56-S02, CAMP-01 — CAMPAIGNS.md §11).
 *
 * `campaign_metrics` só era semeado com `totalRecipients` na ativação
 * (lifecycle) e nenhum job recomputava — o painel mostrava zero para sempre e
 * o rate adaptativo (`effectiveRatePerMinute`) recebia `deliveryRate = null`
 * eternamente. Este job agrega `campaign_deliveries` por status (agora
 * alimentadas pelo receipt via `inbound/status.ts`, CAMP-02) + os replies de
 * `campaign_recipients` e grava o snapshot completo em `campaign_metrics`.
 *
 * Núcleo puro (`computeCampaignMetrics`) atrás de portas injetáveis
 * (`CampaignRecomputePorts`) — testável sem DB. As fórmulas são as do doc:
 *
 * - delivery_rate  = delivered / sent          (frações 0–1, como `rate.ts` lê)
 * - read_rate      = read / delivered
 * - response_rate  = replied / sent
 * - block_rate     = blocked / sent
 * - health_status  = critical se dr < 0.70 ou br >= 0.05;
 *                    warning  se dr < 0.85 ou br >= 0.02; senão healthy.
 *
 * Contagens são CUMULATIVAS na progressão (uma delivery `read` conta como
 * sent+delivered+read) — senão as taxas estourariam 1 conforme os acks avançam.
 */
import type { Logger } from '@hm/logger';

/** Campanha elegível para recompute (referência cross-tenant mínima). */
export interface RecomputeCampaignRef {
  readonly id: string;
  readonly workspaceId: string;
}

/**
 * Agregado bruto por campanha: contagem de deliveries POR STATUS ATUAL (não
 * cumulativa — a derivação cumulativa é do núcleo puro) + recipients.
 */
export interface CampaignDeliveryAggregate {
  /** count(*) de campaign_recipients (fonte da verdade do denominador total). */
  readonly totalRecipients: number;
  /** count de campaign_recipients com responded = true. */
  readonly replied: number;
  readonly queued: number;
  readonly sent: number;
  readonly delivered: number;
  readonly read: number;
  readonly failed: number;
  readonly blocked: number;
}

/** Snapshot pronto para gravar em `campaign_metrics`. Rates em fração 0–1. */
export interface CampaignMetricsSnapshot {
  readonly totalRecipients: number;
  readonly messagesQueued: number;
  readonly messagesSent: number;
  readonly messagesDelivered: number;
  readonly messagesRead: number;
  readonly messagesReplied: number;
  readonly messagesFailed: number;
  readonly messagesBlocked: number;
  /** numeric(5,2) → string com 2 casas; `null` = sem denominador ainda. */
  readonly deliveryRate: string | null;
  readonly readRate: string | null;
  readonly responseRate: string | null;
  readonly blockRate: string | null;
  readonly healthStatus: 'healthy' | 'warning' | 'critical';
}

/** Fração com 2 casas (shape do numeric(5,2)); `null` quando sem denominador. */
function rate(numerator: number, denominator: number): string | null {
  if (denominator <= 0) return null;
  return (numerator / denominator).toFixed(2);
}

/**
 * Health por CAMPAIGNS.md §11. Sem dados (`deliveryRate` null) = healthy — não
 * alarma campanha que ainda não enviou nada. `blockRate` null conta como 0.
 */
export function healthStatusOf(
  deliveryRate: number | null,
  blockRate: number | null,
): 'healthy' | 'warning' | 'critical' {
  if (deliveryRate === null) return 'healthy';
  const br = blockRate ?? 0;
  if (deliveryRate < 0.7 || br >= 0.05) return 'critical';
  if (deliveryRate < 0.85 || br >= 0.02) return 'warning';
  return 'healthy';
}

/**
 * Deriva o snapshot de métricas do agregado bruto (pura). Cumulatividade:
 * `sent ⊇ delivered ⊇ read` na progressão do receipt, então
 * `messagesSent = sent + delivered + read` etc.
 */
export function computeCampaignMetrics(agg: CampaignDeliveryAggregate): CampaignMetricsSnapshot {
  const messagesRead = agg.read;
  const messagesDelivered = agg.delivered + agg.read;
  const messagesSent = agg.sent + messagesDelivered;

  const deliveryRate = rate(messagesDelivered, messagesSent);
  const readRate = rate(messagesRead, messagesDelivered);
  const responseRate = rate(agg.replied, messagesSent);
  const blockRate = rate(agg.blocked, messagesSent);

  return {
    totalRecipients: agg.totalRecipients,
    messagesQueued: agg.queued,
    messagesSent,
    messagesDelivered,
    messagesRead,
    messagesReplied: agg.replied,
    messagesFailed: agg.failed,
    messagesBlocked: agg.blocked,
    deliveryRate,
    readRate,
    responseRate,
    blockRate,
    healthStatus: healthStatusOf(
      deliveryRate === null ? null : Number(deliveryRate),
      blockRate === null ? null : Number(blockRate),
    ),
  };
}

/** Portas do job (implementação DB real em `db-ports.ts`; fakes nos testes). */
export interface CampaignRecomputePorts {
  /**
   * Campanhas elegíveis: running/paused (painel ao vivo) + terminais recentes
   * (acks de leitura continuam chegando dias após o fim).
   */
  listRecomputableCampaigns(now: Date): Promise<RecomputeCampaignRef[]>;
  /** Agrega deliveries por status + recipients (RLS via withWorkspace). */
  aggregateDeliveries(campaign: RecomputeCampaignRef): Promise<CampaignDeliveryAggregate>;
  /** Upsert do snapshot em `campaign_metrics` (RLS via withWorkspace). */
  saveMetrics(
    campaign: RecomputeCampaignRef,
    snapshot: CampaignMetricsSnapshot,
    now: Date,
  ): Promise<void>;
}

export interface CampaignRecomputeDeps {
  readonly ports: CampaignRecomputePorts;
  readonly logger: Logger;
}

/** Resultado observável de um tick (log/teste). */
export interface RecomputeTickResult {
  readonly campaigns: number;
  readonly recomputed: number;
  readonly failed: number;
}

/**
 * Um tick de recompute: agrega e grava por campanha. Falha em UMA campanha não
 * derruba as demais (loga-error e segue) — só o erro de listagem propaga para o
 * scheduler (que também não morre; próximo tick recomeça).
 */
export async function runCampaignMetricsRecompute(
  deps: CampaignRecomputeDeps,
  now: Date = new Date(),
): Promise<RecomputeTickResult> {
  const campaigns = await deps.ports.listRecomputableCampaigns(now);
  let recomputed = 0;
  let failed = 0;

  for (const campaign of campaigns) {
    try {
      const agg = await deps.ports.aggregateDeliveries(campaign);
      const snapshot = computeCampaignMetrics(agg);
      await deps.ports.saveMetrics(campaign, snapshot, now);
      recomputed += 1;
    } catch (err: unknown) {
      failed += 1;
      deps.logger.error('campaigns/recompute: falha ao recomputar campanha', {
        campaignId: campaign.id,
        workspaceId: campaign.workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (recomputed > 0) {
    deps.logger.debug('campaigns/recompute: métricas recomputadas', {
      campaigns: campaigns.length,
      recomputed,
      failed,
    });
  }

  return { campaigns: campaigns.length, recomputed, failed };
}
