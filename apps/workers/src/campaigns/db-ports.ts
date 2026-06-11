/**
 * Implementacao das CampaignTickPorts contra @hm/db + RLS (CAMPAIGNS.md 8).
 * enqueueDelivery e o coracao da idempotencia: insere campaign_deliveries com
 * idempotencyKey UNIQUE; conflito -> duplicate (NUNCA reenvia). Em sucesso resolve
 * a conversa, persiste a mensagem pending e publica o OutboundJob template em
 * hm.q.outbound (reusa o pipeline de envio F1-S07).
 */
import { Buffer } from 'node:buffer';
import { and, eq, lte, or, isNull } from 'drizzle-orm';
import { decryptSecret, getDb, schema, withWorkspace } from '@hm/db';
import type { DbTx } from '@hm/db';
import { GraphClient, fetchChannelQuality, type ChannelHealth } from '@hm/channels';
import { makeEnvelope, QUEUES } from '@hm/shared/mq';
import type { MqHandle } from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import type { CampaignErrorAction } from '@hm/channels';
import type {
  CampaignTickPorts,
  DispatchOutcome,
  PendingDispatch,
  RunningCampaign,
} from './tick';
import type { SendWindows } from './windows';

type MqChannel = MqHandle['channel'];

const {
  campaigns,
  campaignSteps,
  campaignRecipients,
  campaignDeliveries,
  channels,
  channelSecrets,
  contacts,
  conversations,
  messages,
} = schema;

export const OUTBOUND_QUEUE = QUEUES.outbound;
export const OUTBOUND_JOB_TYPE = 'outbound.request';

export interface CampaignDbDeps {
  readonly channel: MqChannel;
  readonly logger: Logger;
  readonly graph?: GraphClient;
}

async function loadChannelToken(
  tx: DbTx,
  channelId: string,
): Promise<{ accessToken: string; phoneNumberId: string } | null> {
  const [channel] = await tx.select().from(channels).where(eq(channels.id, channelId));
  if (!channel) return null;
  const [secret] = await tx
    .select()
    .from(channelSecrets)
    .where(eq(channelSecrets.channelId, channelId));
  const accessToken = secret ? decryptSecret(secret.accessTokenEnc, secret.keyVersion) : '';
  return { accessToken, phoneNumberId: channel.phoneNumberId ?? '' };
}

export function createCampaignTickPorts(deps: CampaignDbDeps): CampaignTickPorts {
  const graph = deps.graph ?? new GraphClient();

  return {
    async listDueCampaigns(now: Date): Promise<RunningCampaign[]> {
      const rows = await getDb()
        .select({
          id: campaigns.id,
          workspaceId: campaigns.workspaceId,
          channelId: campaigns.channelId,
          sendWindows: campaigns.sendWindows,
          rateLimitPerMinute: campaigns.rateLimitPerMinute,
        })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.status, 'running'),
            or(isNull(campaigns.nextTickAt), lte(campaigns.nextTickAt, now)),
          ),
        );

      const out: RunningCampaign[] = [];
      for (const r of rows) {
        const metricRows = await withWorkspace(r.workspaceId, (tx) =>
          tx
            .select({ deliveryRate: schema.campaignMetrics.deliveryRate })
            .from(schema.campaignMetrics)
            .where(eq(schema.campaignMetrics.campaignId, r.id)),
        );
        const m = metricRows[0];
        out.push({
          id: r.id,
          workspaceId: r.workspaceId,
          channelId: r.channelId,
          sendWindows: r.sendWindows as SendWindows | null,
          rateLimitPerMinute: r.rateLimitPerMinute,
          deliveryRate: m && m.deliveryRate != null ? Number(m.deliveryRate) : null,
        });
      }
      return out;
    },

    async fetchQuality(campaign: RunningCampaign): Promise<ChannelHealth> {
      return withWorkspace(campaign.workspaceId, async (tx) => {
        const creds = await loadChannelToken(tx, campaign.channelId);
        if (!creds || !creds.phoneNumberId) {
          return { qualityRating: 'UNKNOWN', tierLimit: 250 };
        }
        return fetchChannelQuality(graph, {
          phoneNumberId: creds.phoneNumberId,
          accessToken: creds.accessToken,
        });
      });
    },

    async pendingRecipients(
      campaign: RunningCampaign,
      limit: number,
    ): Promise<PendingDispatch[]> {
      return withWorkspace(campaign.workspaceId, async (tx) => {
        const recipients = await tx
          .select({
            recipientId: campaignRecipients.id,
            contactId: campaignRecipients.contactId,
            lastStepIndex: campaignRecipients.lastStepIndex,
          })
          .from(campaignRecipients)
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.status, 'pending'),
            ),
          )
          .limit(limit);

        const steps = await tx
          .select({ id: campaignSteps.id, position: campaignSteps.position })
          .from(campaignSteps)
          .where(eq(campaignSteps.campaignId, campaign.id))
          .orderBy(campaignSteps.position);

        const out: PendingDispatch[] = [];
        for (const r of recipients) {
          const nextIdx = (r.lastStepIndex ?? -1) + 1;
          const step = steps[nextIdx];
          if (!step) continue;
          out.push({
            recipientId: r.recipientId,
            contactId: r.contactId,
            stepId: step.id,
            stepIndex: nextIdx,
          });
        }
        return out;
      });
    },

    async enqueueDelivery(
      campaign: RunningCampaign,
      dispatch: PendingDispatch,
      idempotencyKey: string,
    ): Promise<DispatchOutcome> {
      return withWorkspace(campaign.workspaceId, async (tx) => {
        const inserted = await tx
          .insert(campaignDeliveries)
          .values({
            workspaceId: campaign.workspaceId,
            campaignId: campaign.id,
            recipientId: dispatch.recipientId,
            stepId: dispatch.stepId,
            idempotencyKey,
            status: 'queued',
          })
          .onConflictDoNothing({ target: campaignDeliveries.idempotencyKey })
          .returning({ id: campaignDeliveries.id });
        const insertedRow = inserted[0];
        if (!insertedRow) {
          return { kind: 'duplicate' };
        }
        const deliveryId = insertedRow.id;

        const [step] = await tx
          .select()
          .from(campaignSteps)
          .where(eq(campaignSteps.id, dispatch.stepId));
        const [contact] = await tx
          .select({ phone: contacts.phone })
          .from(contacts)
          .where(eq(contacts.id, dispatch.contactId));
        if (!step || !contact || !contact.phone) {
          return { kind: 'error', errorCode: '131008' };
        }
        const phone = contact.phone;

        const [existingConv] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(
            and(
              eq(conversations.channelId, campaign.channelId),
              eq(conversations.remoteId, phone),
            ),
          );
        let conversationId: string;
        if (existingConv) {
          conversationId = existingConv.id;
        } else {
          const convRows = await tx
            .insert(conversations)
            .values({
              workspaceId: campaign.workspaceId,
              channelId: campaign.channelId,
              contactId: dispatch.contactId,
              remoteId: phone,
              status: 'open',
            })
            .returning({ id: conversations.id });
          const conv = convRows[0];
          if (!conv) return { kind: 'error', errorCode: '131008' };
          conversationId = conv.id;
        }

        const messageRows = await tx
          .insert(messages)
          .values({
            workspaceId: campaign.workspaceId,
            conversationId,
            direction: 'outbound',
            senderType: 'system',
            type: 'template',
            content: step.templateName,
            viewStatus: 'pending',
            metadata: { campaignId: campaign.id, deliveryId },
          })
          .returning({ id: messages.id });
        const message = messageRows[0];
        if (!message) return { kind: 'error', errorCode: '131008' };
        const messageId = message.id;

        await tx
          .update(campaignDeliveries)
          .set({ messageId })
          .where(eq(campaignDeliveries.id, deliveryId));

        await tx
          .update(campaignRecipients)
          .set({
            status: 'sending',
            lastStepIndex: dispatch.stepIndex,
            lastStepAt: new Date(),
          })
          .where(eq(campaignRecipients.id, dispatch.recipientId));

        const job = {
          kind: 'template',
          channelId: campaign.channelId,
          conversationId,
          messageId,
          chatId: phone,
          templateName: step.templateName,
          languageCode: step.languageCode,
          components: step.templateComponents ?? [],
        };
        const envelope = makeEnvelope(OUTBOUND_JOB_TYPE, campaign.workspaceId, job);
        deps.channel.sendToQueue(OUTBOUND_QUEUE, Buffer.from(JSON.stringify(envelope)), {
          persistent: true,
          contentType: 'application/json',
        });

        return { kind: 'enqueued' };
      });
    },

    async pauseCampaign(campaignId: string, reason: string): Promise<void> {
      const rows = await getDb()
        .select({ workspaceId: campaigns.workspaceId })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId));
      const row = rows[0];
      if (!row) return;
      await withWorkspace(row.workspaceId, (tx) =>
        tx
          .update(campaigns)
          .set({ status: 'paused', nextTickAt: null, updatedAt: new Date() })
          .where(eq(campaigns.id, campaignId)),
      );
      deps.logger.warn('campaigns: campanha pausada', { campaignId, reason });
    },

    async scheduleNextTick(campaignId: string, at: Date): Promise<void> {
      const rows = await getDb()
        .select({ workspaceId: campaigns.workspaceId })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId));
      const row = rows[0];
      if (!row) return;
      await withWorkspace(row.workspaceId, (tx) =>
        tx.update(campaigns).set({ nextTickAt: at }).where(eq(campaigns.id, campaignId)),
      );
    },

    async applyErrorAction(
      campaign: RunningCampaign,
      dispatch: PendingDispatch,
      action: CampaignErrorAction,
    ): Promise<void> {
      await withWorkspace(campaign.workspaceId, async (tx) => {
        switch (action.kind) {
          case 'invalidate_recipient':
          case 'needs_reengagement':
          case 'count_block':
            await tx
              .update(campaignRecipients)
              .set({ status: 'failed', failedReason: action.reason })
              .where(eq(campaignRecipients.id, dispatch.recipientId));
            break;
          case 'fail_delivery':
            await tx
              .update(campaignDeliveries)
              .set({ status: 'failed', errorMessage: action.reason, failedAt: new Date() })
              .where(
                and(
                  eq(campaignDeliveries.campaignId, campaign.id),
                  eq(campaignDeliveries.recipientId, dispatch.recipientId),
                  eq(campaignDeliveries.stepId, dispatch.stepId),
                ),
              );
            break;
          case 'pause_campaign':
            break;
        }
      });
    },
  };
}
