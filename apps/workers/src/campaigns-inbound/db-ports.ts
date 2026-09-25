/**
 * Implementacao das CampaignInboundPorts contra @hm/db + RLS + outbox.
 * findRecentDelivery: ultima delivery do contato em ate 7d (join deliveries ->
 * recipients -> campaigns, filtrando pelo contato e canal). optOutContact espelha
 * a regra da API (F6-S04): marca opt-out + tira de campanhas MARKETING pendentes.
 *
 * F70-S25 — nada e publicado depois do commit:
 * - a confirmacao de opt-out vira uma mensagem `pending` REAL na conversa + o job de
 *   envio, na transacao do opt-out. Antes o job ia com `messageId: 'opt-out-confirm'`,
 *   sem linha em `messages`: o worker outbound nao tinha o que atualizar;
 * - o followup `on_reply` (que S06 materializa em scheduled_followups) entra na outbox
 *   com a marca de resposta do recipient.
 *
 * F70-S08 — handoffToAgent NAO tem mais UPDATE proprio: liga a IA pelo port de
 * outbound da flow-engine (`setConversationAi`), cujo UPDATE e condicional no
 * predicado unico da trava (`aiOriginGateSql`: configuracao do workspace, F70-S30, e
 * `origin` da conversa; atomico, fail-closed). Nao existe caminho cru para
 * religar por engano, nem se alguem montar estes ports sem o `gateCampaignAiHandoff`.
 */
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { enqueueOutbox, schema, withWorkspace } from '@hm/db';
import { createOutboundPort, type FlowOutboundPort } from '@hm/flow-engine';
import { makeEnvelope, queueJobOutbox, QUEUES } from '@hm/shared/mq';
import type { Logger } from '@hm/logger';
import type {
  CampaignInboundPorts,
  HandoffResult,
  InboundMessage,
  RecentDelivery,
} from './processor';

const {
  campaigns,
  campaignRecipients,
  campaignDeliveries,
  campaignFollowups,
  contacts,
  conversations,
  messages,
} = schema;

/** Fila de followups de campanha (consumida por F6-S06). */
export const CAMPAIGN_FOLLOWUP_QUEUE = QUEUES.campaigns;
export const CAMPAIGN_FOLLOWUP_TYPE = 'campaign.followup';
export const OUTBOUND_QUEUE = QUEUES.outbound;
export const OUTBOUND_JOB_TYPE = 'outbound.request';

/** Janela de 7 dias para correlacionar reply com delivery (CAMPAIGNS.md 8.3/16). */
const REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Texto da confirmacao automatica de opt-out. */
export const OPT_OUT_CONFIRMATION_TEXT =
  'Voce foi removido das nossas comunicacoes de marketing. Para voltar a receber, responda QUERO RECEBER.';

export interface CampaignInboundDbDeps {
  readonly logger: Logger;
  /**
   * Mutacao de IA com a trava de origem. Default: o port real de outbound da
   * flow-engine. Injetavel para teste; nunca um UPDATE sem trava.
   */
  readonly ai?: Pick<FlowOutboundPort, 'setConversationAi'>;
}

export function createCampaignInboundPorts(
  deps: CampaignInboundDbDeps,
): CampaignInboundPorts {
  const ai = deps.ai ?? createOutboundPort();
  return {
    async optOutContact(message: InboundMessage, reason: string): Promise<void> {
      const { workspaceId, contactId } = message;
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

        // Confirmacao automatica (pipeline outbound, kind text): mensagem `pending` real
        // e job, nesta transacao. chatId = remote_id da conversa. Sem a conversa (apagada
        // no meio), o opt-out vale do mesmo jeito e nada e enviado.
        const [conv] = await tx
          .select({ remoteId: conversations.remoteId })
          .from(conversations)
          .where(eq(conversations.id, message.conversationId));
        if (conv === undefined) return;
        const [confirmation] = await tx
          .insert(messages)
          .values({
            workspaceId,
            conversationId: message.conversationId,
            direction: 'outbound',
            senderType: 'system',
            type: 'text',
            content: OPT_OUT_CONFIRMATION_TEXT,
            viewStatus: 'pending',
            metadata: { source: 'campaign_opt_out', reason },
          })
          .returning({ id: messages.id });
        if (confirmation === undefined) {
          throw new Error('campaigns-inbound: confirmacao de opt-out nao materializou.');
        }
        const job = {
          kind: 'text',
          channelId: message.channelId,
          conversationId: message.conversationId,
          messageId: confirmation.id,
          chatId: conv.remoteId,
          text: OPT_OUT_CONFIRMATION_TEXT,
        };
        await enqueueOutbox(
          tx,
          queueJobOutbox(OUTBOUND_QUEUE, makeEnvelope(OUTBOUND_JOB_TYPE, workspaceId, job)),
        );
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

    async markRecipientResponded(workspaceId, recipientId, onReplyFollowup): Promise<void> {
      await withWorkspace(workspaceId, async (tx) => {
        await tx
          .update(campaignRecipients)
          .set({ status: 'responded', responded: true, respondedAt: new Date() })
          .where(eq(campaignRecipients.id, recipientId));
        if (onReplyFollowup === null) return;
        // F70-S25: o followup on_reply entra com a marca de resposta (commit grava os dois).
        await enqueueOutbox(
          tx,
          queueJobOutbox(
            CAMPAIGN_FOLLOWUP_QUEUE,
            makeEnvelope(CAMPAIGN_FOLLOWUP_TYPE, workspaceId, {
              campaignId: onReplyFollowup.campaignId,
              recipientId,
              event: 'on_reply',
            }),
          ),
        );
      });
    },

    async handoffToAgent(message: InboundMessage, agentId: string): Promise<HandoffResult> {
      // F70-S08/S30: mesma trava do flow `ai_action` — com a trava do workspace ligada,
      // conversa sem origem comprovada continua com a IA desligada; a recusa e
      // registrada, o processor segue. Trava desligada: liga.
      const result = await ai.setConversationAi(message.workspaceId, {
        conversationId: message.conversationId,
        aiMode: 'on',
        agentId,
      });
      if (!result.applied) {
        deps.logger.warn('campaigns-inbound: handoff para IA recusado pela trava de origem', {
          workspaceId: message.workspaceId,
          conversationId: message.conversationId,
          agentId,
          reason: result.reason,
        });
      }
      return { applied: result.applied };
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
