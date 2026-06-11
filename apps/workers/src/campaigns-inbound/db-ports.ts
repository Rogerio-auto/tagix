/**
 * Implementacao das CampaignInboundPorts contra @hm/db + RLS + MQ.
 * findRecentDelivery: ultima delivery do contato em ate 7d (join deliveries ->
 * recipients -> campaigns, filtrando pelo contato e canal). optOutContact espelha
 * a regra da API (F6-S04): marca opt-out + tira de campanhas MARKETING pendentes.
 * publishFollowup enfileira o evento que S06 materializa em scheduled_followups.
 */
import { Buffer } from 'node:buffer';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import { makeEnvelope, QUEUES } from '@hm/shared/mq';
import type { MqHandle } from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import type {
  CampaignInboundPorts,
  InboundMessage,
  RecentDelivery,
} from './processor';

type MqChannel = MqHandle['channel'];

const {
  campaigns,
  campaignRecipients,
  campaignDeliveries,
  campaignFollowups,
  contacts,
  conversations,
} = schema;

/** Fila de followups de campanha (consumida por F6-S06). */
export const CAMPAIGN_FOLLOWUP_QUEUE = QUEUES.outbound;
export const CAMPAIGN_FOLLOWUP_TYPE = 'campaign.followup';
export const OUTBOUND_QUEUE = QUEUES.outbound;
export const OUTBOUND_JOB_TYPE = 'outbound.request';

/** Janela de 7 dias para correlacionar reply com delivery (CAMPAIGNS.md 8.3/16). */
const REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface CampaignInboundDbDeps {
  readonly channel: MqChannel;
  readonly logger: Logger;
}

export function createCampaignInboundPorts(
  deps: CampaignInboundDbDeps,
): CampaignInboundPorts {
  return {
    async optOutContact(workspaceId, contactId, reason): Promise<void> {
      await withWorkspace(workspaceId, async (tx) => {
        await tx
          .update(contacts)
          .set({
            marketingOptIn: false,
            optOutAt: new Date(),
            optOutReason: reason,
            updatedAt: new Date(),
          })
          .where(eq(contacts.id, contactId));
        await tx
          .update(campaignRecipients)
          .set({ status: 'opted_out' })
          .where(
            and(
              eq(campaignRecipients.contactId, contactId),
              inArray(campaignRecipients.status, ['pending', 'sending']),
            ),
          );
      });
    },

    async sendOptOutConfirmation(message: InboundMessage): Promise<void> {
      // Reusa o pipeline outbound (kind text). chatId resolvido pelo remote_id da conversa.
      const remote = await withWorkspace(message.workspaceId, async (tx) => {
        const [conv] = await tx
          .select({ remoteId: conversations.remoteId })
          .from(conversations)
          .where(eq(conversations.id, message.conversationId));
        return conv?.remoteId ?? null;
      });
      if (!remote) return;
      const job = {
        kind: 'text',
        channelId: message.channelId,
        conversationId: message.conversationId,
        messageId: 'opt-out-confirm',
        chatId: remote,
        text: 'Voce foi removido das nossas comunicacoes de marketing. Para voltar a receber, responda QUERO RECEBER.',
      };
      const envelope = makeEnvelope(OUTBOUND_JOB_TYPE, message.workspaceId, job);
      deps.channel.sendToQueue(OUTBOUND_QUEUE, Buffer.from(JSON.stringify(envelope)), {
        persistent: true,
        contentType: 'application/json',
      });
    },

    async findRecentDelivery(message: InboundMessage): Promise<RecentDelivery | null> {
      const since = new Date(Date.now() - REPLY_WINDOW_MS);
      return withWorkspace(message.workspaceId, async (tx) => {
        const rows = await tx
          .select({
            deliveryId: campaignDeliveries.id,
            campaignId: campaignDeliveries.campaignId,
            recipientId: campaignDeliveries.recipientId,
            autoHandoffOnReply: campaigns.autoHandoffOnReply,
            aiHandoffAgentId: campaigns.aiHandoffAgentId,
          })
          .from(campaignDeliveries)
          .innerJoin(
            campaignRecipients,
            eq(campaignDeliveries.recipientId, campaignRecipients.id),
          )
          .innerJoin(campaigns, eq(campaignDeliveries.campaignId, campaigns.id))
          .where(
            and(
              eq(campaignRecipients.contactId, message.contactId),
              eq(campaigns.channelId, message.channelId),
              gte(campaignDeliveries.queuedAt, since),
            ),
          )
          .orderBy(desc(campaignDeliveries.queuedAt))
          .limit(1);
        const row = rows[0];
        if (!row) return null;

        const followupRows = await tx
          .select({ id: campaignFollowups.id })
          .from(campaignFollowups)
          .where(
            and(
              eq(campaignFollowups.campaignId, row.campaignId),
              eq(campaignFollowups.triggerEvent, 'on_reply'),
              eq(campaignFollowups.isActive, true),
            ),
          )
          .limit(1);

        return {
          deliveryId: row.deliveryId,
          campaignId: row.campaignId,
          recipientId: row.recipientId,
          autoHandoffOnReply: row.autoHandoffOnReply,
          aiHandoffAgentId: row.aiHandoffAgentId,
          hasOnReplyFollowup: followupRows.length > 0,
        };
      });
    },

    async markRecipientResponded(workspaceId, recipientId): Promise<void> {
      await withWorkspace(workspaceId, (tx) =>
        tx
          .update(campaignRecipients)
          .set({ status: 'responded', responded: true, respondedAt: new Date() })
          .where(eq(campaignRecipients.id, recipientId)),
      );
    },

    async handoffToAgent(message: InboundMessage, agentId: string): Promise<void> {
      await withWorkspace(message.workspaceId, (tx) =>
        tx
          .update(conversations)
          .set({ aiMode: 'on', agentId, updatedAt: new Date() })
          .where(eq(conversations.id, message.conversationId)),
      );
    },

    async publishFollowup(args): Promise<void> {
      const envelope = makeEnvelope(CAMPAIGN_FOLLOWUP_TYPE, args.workspaceId, {
        campaignId: args.campaignId,
        recipientId: args.recipientId,
        event: args.event,
      });
      deps.channel.sendToQueue(
        CAMPAIGN_FOLLOWUP_QUEUE,
        Buffer.from(JSON.stringify(envelope)),
        { persistent: true, contentType: 'application/json' },
      );
    },
  };
}

/** Resolve a InboundMessage (channel/contact/conversation/text) a partir do par
 *  (channelId, remoteId) — usado pelo hook do pipeline inbound. */
export async function resolveInboundMessage(
  workspaceId: string,
  channelId: string,
  remoteId: string,
  text: string | null,
): Promise<InboundMessage | null> {
  return withWorkspace(workspaceId, async (tx) => {
    const [conv] = await tx
      .select({ id: conversations.id, contactId: conversations.contactId })
      .from(conversations)
      .where(
        and(eq(conversations.channelId, channelId), eq(conversations.remoteId, remoteId)),
      );
    if (!conv || !conv.contactId) return null;
    return {
      workspaceId,
      channelId,
      contactId: conv.contactId,
      conversationId: conv.id,
      text,
    };
  });
}
