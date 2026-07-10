/**
 * Portas DB reais do recompute de métricas (F56-S02) contra `@hm/db`.
 *
 * Mesma disciplina de `campaigns/db-ports.ts`: descoberta cross-tenant de
 * campanhas via `getDb()` (o worker ainda não conhece o tenant); TODO o resto
 * (agregação + upsert) roda `withWorkspace` (RLS).
 *
 * Elegibilidade: campanhas `running`/`paused` (painel ao vivo) + terminais
 * (`completed`/`cancelled`) atualizadas nos últimos 7 dias — read receipts
 * continuam chegando dias depois do fim e precisam refletir no snapshot.
 */
import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { getDb, schema, withWorkspace } from '@hm/db';
import type {
  CampaignDeliveryAggregate,
  CampaignMetricsSnapshot,
  CampaignRecomputePorts,
  RecomputeCampaignRef,
} from './job';

const { campaigns, campaignDeliveries, campaignRecipients, campaignMetrics } = schema;

/** Janela de graça pós-término em que a campanha ainda é recomputada. */
export const TERMINAL_RECOMPUTE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** `count(*) filter (where status = X)` tipado como number. */
function countWithStatus(status: string) {
  return sql<number>`count(*) filter (where ${campaignDeliveries.status} = ${status})`.mapWith(
    Number,
  );
}

export function createCampaignRecomputePorts(): CampaignRecomputePorts {
  return {
    async listRecomputableCampaigns(now: Date): Promise<RecomputeCampaignRef[]> {
      const cutoff = new Date(now.getTime() - TERMINAL_RECOMPUTE_GRACE_MS);
      return getDb()
        .select({ id: campaigns.id, workspaceId: campaigns.workspaceId })
        .from(campaigns)
        .where(
          or(
            inArray(campaigns.status, ['running', 'paused']),
            and(
              inArray(campaigns.status, ['completed', 'cancelled']),
              gte(campaigns.updatedAt, cutoff),
            ),
          ),
        );
    },

    async aggregateDeliveries(
      campaign: RecomputeCampaignRef,
    ): Promise<CampaignDeliveryAggregate> {
      return withWorkspace(campaign.workspaceId, async (tx) => {
        const [deliveries] = await tx
          .select({
            queued: countWithStatus('queued'),
            sent: countWithStatus('sent'),
            delivered: countWithStatus('delivered'),
            read: countWithStatus('read'),
            failed: countWithStatus('failed'),
            blocked: countWithStatus('blocked'),
          })
          .from(campaignDeliveries)
          .where(eq(campaignDeliveries.campaignId, campaign.id));

        const [recipients] = await tx
          .select({
            total: sql<number>`count(*)`.mapWith(Number),
            replied: sql<number>`count(*) filter (where ${campaignRecipients.responded})`.mapWith(
              Number,
            ),
          })
          .from(campaignRecipients)
          .where(eq(campaignRecipients.campaignId, campaign.id));

        return {
          totalRecipients: recipients?.total ?? 0,
          replied: recipients?.replied ?? 0,
          queued: deliveries?.queued ?? 0,
          sent: deliveries?.sent ?? 0,
          delivered: deliveries?.delivered ?? 0,
          read: deliveries?.read ?? 0,
          failed: deliveries?.failed ?? 0,
          blocked: deliveries?.blocked ?? 0,
        };
      });
    },

    async saveMetrics(
      campaign: RecomputeCampaignRef,
      snapshot: CampaignMetricsSnapshot,
      now: Date,
    ): Promise<void> {
      // Upsert (não UPDATE seco): resiliente a campanha ativada antes do seed
      // de lifecycle existir. O set é idêntico nos dois ramos — o recompute é a
      // fonte da verdade do snapshot inteiro (incl. totalRecipients, derivado
      // da MESMA tabela que o seed conta).
      const values = {
        totalRecipients: snapshot.totalRecipients,
        messagesQueued: snapshot.messagesQueued,
        messagesSent: snapshot.messagesSent,
        messagesDelivered: snapshot.messagesDelivered,
        messagesRead: snapshot.messagesRead,
        messagesReplied: snapshot.messagesReplied,
        messagesFailed: snapshot.messagesFailed,
        messagesBlocked: snapshot.messagesBlocked,
        deliveryRate: snapshot.deliveryRate,
        readRate: snapshot.readRate,
        responseRate: snapshot.responseRate,
        blockRate: snapshot.blockRate,
        healthStatus: snapshot.healthStatus,
        updatedAt: now,
      };
      await withWorkspace(campaign.workspaceId, (tx) =>
        tx
          .insert(campaignMetrics)
          .values({ campaignId: campaign.id, workspaceId: campaign.workspaceId, ...values })
          .onConflictDoUpdate({ target: campaignMetrics.campaignId, set: values }),
      );
    },
  };
}
