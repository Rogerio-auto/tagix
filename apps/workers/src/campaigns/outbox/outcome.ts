/**
 * Desfecho do worker outbound devolvido à delivery e à campanha (F58-S12).
 *
 * Antes, `campaign_deliveries` só saía de `queued` quando o webhook de status da Meta
 * chegava. Falha no envio (número inválido, consentimento recusado, modelo pausado,
 * retentativas esgotadas) nunca gera webhook: a delivery ficava `queued` para sempre, o
 * relatório mentia e a campanha seguia mandando o mesmo modelo recusado para o resto da
 * lista.
 *
 * Roda DENTRO da transação em que o outbound grava o status da mensagem
 * (`DbOutboundPersistence`): mensagem, delivery, recipient e pausa commitam juntos.
 *
 *  - sucesso/recibo (`sent`/`delivered`/`read`): mesma propagação monotônica do webhook
 *    (`propagateStatusToCampaignDelivery`), já com o `external_id`;
 *  - falha permanente: delivery `failed` com o código e a mensagem do provider;
 *     · código que vale para o MODELO -> a campanha PAUSA (só se `running`) com motivo e
 *       orientação em `audit_logs`; o trigger `campaign_outbox_gate` retém, na mesma
 *       transação, os jobs da campanha que ainda não foram publicados;
 *     · qualquer outro código -> o recipient que ainda tinha passos (`pending`) sai da
 *       sequência como `failed`: não adianta mandar o passo 2 para quem não recebeu o 1.
 *
 * Mensagem fora de campanha (sem `metadata.deliveryId`) não toca em nada.
 */
import { and, eq } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import type { ViewStatus } from '@hm/shared';
import { propagateStatusToCampaignDelivery } from '../../inbound/status';
import {
  TEMPLATE_PAUSE_GUIDANCE,
  templateFailureReason,
  type TemplatePauseReason,
} from './template-gate';

const { campaigns, campaignDeliveries, campaignRecipients, auditLogs } = schema;

/** Teto do texto de erro do provider guardado na delivery. */
const ERROR_MESSAGE_MAX_LEN = 500;

export interface CampaignDeliveryOutcomeInput {
  readonly workspaceId: string;
  readonly messageId: string;
  /** `messages.metadata` — `{ campaignId, deliveryId }` quando a mensagem é de campanha. */
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly status: ViewStatus;
  readonly externalId?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly at: Date;
}

export type CampaignDeliveryOutcome =
  | { readonly kind: 'not_campaign' }
  | { readonly kind: 'recorded' }
  /** A delivery já tinha desfecho (redelivery do job, webhook na frente): nada mudou. */
  | { readonly kind: 'unchanged' }
  | {
      readonly kind: 'failed';
      readonly campaignId: string;
      /** Motivo da pausa quando a falha é do modelo (a campanha pausou agora ou já estava parada). */
      readonly pauseReason: TemplatePauseReason | null;
      /** `true` se ESTA transação pausou a campanha. */
      readonly pausedNow: boolean;
    };

function stringField(
  metadata: Readonly<Record<string, unknown>> | null,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function applyCampaignDeliveryOutcome(
  tx: DbTx,
  input: CampaignDeliveryOutcomeInput,
): Promise<CampaignDeliveryOutcome> {
  const deliveryId = stringField(input.metadata, 'deliveryId');
  const campaignId = stringField(input.metadata, 'campaignId');
  if (deliveryId === null || campaignId === null) return { kind: 'not_campaign' };
  if (input.status === 'pending') return { kind: 'unchanged' };

  if (input.status !== 'failed') {
    await propagateStatusToCampaignDelivery(tx, {
      messageId: input.messageId,
      metadata: { deliveryId },
      status: input.status,
      at: input.at,
      ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
    });
    return { kind: 'recorded' };
  }

  // Falha vinda do outbound só vale para delivery ainda sem desfecho: nunca apaga um
  // sucesso já registrado (o guard de idempotência não reenvia mensagem já aceita).
  const errorCode = input.errorCode ?? 'outbound_send_failed';
  const failed = await tx
    .update(campaignDeliveries)
    .set({
      status: 'failed',
      errorCode,
      errorMessage: (input.errorMessage ?? errorCode).slice(0, ERROR_MESSAGE_MAX_LEN),
      failedAt: input.at,
    })
    .where(
      and(
        eq(campaignDeliveries.id, deliveryId),
        eq(campaignDeliveries.messageId, input.messageId),
        eq(campaignDeliveries.status, 'queued'),
      ),
    )
    .returning({ recipientId: campaignDeliveries.recipientId });
  const row = failed[0];
  if (row === undefined) return { kind: 'unchanged' };

  const pauseReason = templateFailureReason(input.errorCode);
  if (pauseReason === null) {
    await tx
      .update(campaignRecipients)
      .set({ status: 'failed', failedReason: `delivery_${errorCode}`, nextStepAt: null })
      .where(
        and(eq(campaignRecipients.id, row.recipientId), eq(campaignRecipients.status, 'pending')),
      );
    return { kind: 'failed', campaignId, pauseReason: null, pausedNow: false };
  }

  const paused = await tx
    .update(campaigns)
    .set({ status: 'paused', nextTickAt: null, updatedAt: input.at })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'running')))
    .returning({ id: campaigns.id });
  if (paused.length > 0) {
    await tx.insert(auditLogs).values({
      workspaceId: input.workspaceId,
      actorType: 'system',
      action: 'campaign.paused',
      resourceType: 'campaign',
      resourceId: campaignId,
      metadata: {
        reason: pauseReason,
        message: TEMPLATE_PAUSE_GUIDANCE[pauseReason],
        errorCode,
        deliveryId,
      },
    });
  }
  return { kind: 'failed', campaignId, pauseReason, pausedNow: paused.length > 0 };
}
