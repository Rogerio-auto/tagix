/**
 * Servicos de dados das campanhas: snapshot para validacao + ports de Graph.
 *
 * Carrega a campanha + canal (token decifrado de channel_secrets) e monta o
 * ValidationCampaign agregando contagens (recipients, sem-opt-in, sem-interacao
 * previa p/ IG). As ports de Graph usam @hm/channels (fetchMetaTemplate /
 * fetchChannelQuality) — no dev sem WABA elas batem na Graph real e propagam
 * MetaError; os testes injetam ports mockadas direto em validateCampaign.
 */
import { and, count, eq, sql } from 'drizzle-orm';
import { decryptSecret, schema, type DbTx } from '@hm/db';
import {
  GraphClient,
  fetchChannelQuality,
  fetchMetaTemplate,
} from '@hm/channels';
import type {
  ValidationCampaign,
  ValidationGraphPorts,
  ValidationStep,
} from './validate';

const {
  campaigns,
  campaignSteps,
  campaignRecipients,
  channels,
  channelSecrets,
  contacts,
  conversations,
} = schema;

export interface CampaignChannelSnapshot {
  readonly campaign: typeof campaigns.$inferSelect;
  readonly channel: typeof channels.$inferSelect;
  readonly accessToken: string;
}

/** Carrega campanha + canal + token decifrado (ou null se nao achar). */
export async function loadCampaignChannel(
  tx: DbTx,
  campaignId: string,
): Promise<CampaignChannelSnapshot | null> {
  const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) return null;
  const [channel] = await tx.select().from(channels).where(eq(channels.id, campaign.channelId));
  if (!channel) return null;
  const [secret] = await tx
    .select()
    .from(channelSecrets)
    .where(eq(channelSecrets.channelId, channel.id));
  const accessToken = secret ? decryptSecret(secret.accessTokenEnc, secret.keyVersion) : '';
  return { campaign, channel, accessToken };
}

/** Monta o ValidationCampaign (agrega contagens) a partir do snapshot. */
export async function buildValidationCampaign(
  tx: DbTx,
  snap: CampaignChannelSnapshot,
): Promise<ValidationCampaign> {
  const campaignId = snap.campaign.id;

  const stepRows = await tx
    .select({ templateName: campaignSteps.templateName, languageCode: campaignSteps.languageCode })
    .from(campaignSteps)
    .where(eq(campaignSteps.campaignId, campaignId))
    .orderBy(campaignSteps.position);
  const steps: ValidationStep[] = stepRows.map((s) => ({
    templateName: s.templateName,
    languageCode: s.languageCode,
  }));

  const recipientRows = await tx
    .select({ value: count() })
    .from(campaignRecipients)
    .where(eq(campaignRecipients.campaignId, campaignId));
  const recipientCount = recipientRows[0]?.value ?? 0;

  // Recipients sem opt-in de marketing (join contacts).
  const withoutOptInRows = await tx
    .select({ value: count() })
    .from(campaignRecipients)
    .innerJoin(contacts, eq(campaignRecipients.contactId, contacts.id))
    .where(
      and(eq(campaignRecipients.campaignId, campaignId), eq(contacts.marketingOptIn, false)),
    );
  const withoutOptIn = withoutOptInRows[0]?.value ?? 0;

  // IG: recipients SEM conversa previa nesse canal (proibido pela Meta).
  const withoutPriorRows = await tx
    .select({ value: count() })
    .from(campaignRecipients)
    .where(
      and(
        eq(campaignRecipients.campaignId, campaignId),
        sql`not exists (
          select 1 from ${conversations} cv
          where cv.contact_id = ${campaignRecipients.contactId}
            and cv.channel_id = ${snap.campaign.channelId}
        )`,
      ),
    );
  const withoutPrior = withoutPriorRows[0]?.value ?? 0;

  const provider = snap.channel.provider as ValidationCampaign['provider'];

  return {
    id: campaignId,
    provider,
    steps,
    recipientCount: Number(recipientCount ?? 0),
    recipientsWithoutOptIn: Number(withoutOptIn ?? 0),
    recipientsWithoutPriorInteraction: Number(withoutPrior ?? 0),
    sendWindowsEnabled: Boolean((snap.campaign.sendWindows as { enabled?: boolean }).enabled),
    rateLimitPerMinute: snap.campaign.rateLimitPerMinute,
  };
}

/** Constroi as ports de Graph reais a partir do snapshot (token + waba/phone). */
export function makeGraphPorts(snap: CampaignChannelSnapshot): ValidationGraphPorts {
  const graph = new GraphClient();
  const wabaId = snap.channel.wabaId ?? '';
  const phoneNumberId = snap.channel.phoneNumberId ?? '';
  const accessToken = snap.accessToken;
  return {
    fetchTemplate: (step) =>
      fetchMetaTemplate(graph, {
        wabaId,
        accessToken,
        templateName: step.templateName,
        languageCode: step.languageCode,
      }),
    fetchQuality: () => fetchChannelQuality(graph, { phoneNumberId, accessToken }),
  };
}
