/**
 * Conecta mensagens inbound as campanhas (CAMPAIGNS.md 8.3 + 9.3). Self-contained,
 * via PORTS injetadas (DB/MQ) — testavel sem broker/DB reais.
 *
 * Ao processar uma mensagem inbound text de um contato:
 *  1) OPT-OUT por keyword (match EXATO, optout.ts): opta o contato out + remove
 *     de campanhas MARKETING futuras + envia confirmacao automatica. Para aqui
 *     (nao trata como reply de campanha).
 *  2) REPLY handling: se houve delivery recente desse contato (janela 7d), marca
 *     o recipient como responded, faz AI handoff se a campanha tiver
 *     auto_handoff_on_reply + ai_handoff_agent_id, e publica followup on_reply.
 */
import type { Logger } from '@hm/logger';
import { isOptOutKeyword } from './optout';

/** Mensagem inbound ja persistida, normalizada para o processor. */
export interface InboundMessage {
  readonly workspaceId: string;
  readonly channelId: string;
  readonly contactId: string;
  readonly conversationId: string;
  readonly text: string | null;
}

/** Delivery recente que originou a conversa (janela 7d). */
export interface RecentDelivery {
  readonly deliveryId: string;
  readonly campaignId: string;
  readonly recipientId: string;
  readonly autoHandoffOnReply: boolean;
  readonly aiHandoffAgentId: string | null;
  readonly hasOnReplyFollowup: boolean;
}

/**
 * Resultado do handoff para a IA (F70-S13). `applied=false` quando a trava de origem
 * (F70-S07/S08) recusou: a IA continua desligada e o outcome tem de dizer isso.
 */
export interface HandoffResult {
  readonly applied: boolean;
}

/** Ports do processor — injetadas pelo bootstrap, mockadas em teste. */
export interface CampaignInboundPorts {
  /** Opta o contato out + tira de campanhas MARKETING (reusa optOutContact da API). */
  optOutContact(workspaceId: string, contactId: string, reason: string): Promise<void>;
  /** Envia a confirmacao automatica de opt-out ao contato. */
  sendOptOutConfirmation(message: InboundMessage): Promise<void>;
  /** Delivery mais recente do contato na janela de 7d (ou null). */
  findRecentDelivery(message: InboundMessage): Promise<RecentDelivery | null>;
  /** Marca o recipient como respondido. */
  markRecipientResponded(workspaceId: string, recipientId: string): Promise<void>;
  /** Tenta ligar a IA na conversa com o agente da campanha; devolve se ligou de fato. */
  handoffToAgent(message: InboundMessage, agentId: string): Promise<HandoffResult>;
  /** Publica o evento de followup on_reply (duravel via scheduled_followups). */
  publishFollowup(args: {
    workspaceId: string;
    campaignId: string;
    recipientId: string;
    event: 'on_reply';
  }): Promise<void>;
}

export interface CampaignInboundDeps {
  readonly ports: CampaignInboundPorts;
  readonly logger: Logger;
}

export type CampaignInboundOutcome =
  | { readonly kind: 'opted_out' }
  | { readonly kind: 'reply_handled'; readonly campaignId: string; readonly handedOff: boolean }
  | { readonly kind: 'no_op' };

/**
 * Processa uma mensagem inbound contra as campanhas. Opt-out tem precedencia
 * sobre reply handling (uma mensagem "PARAR" e opt-out, nunca reply).
 */
export async function processCampaignInbound(
  message: InboundMessage,
  deps: CampaignInboundDeps,
): Promise<CampaignInboundOutcome> {
  const { ports, logger } = deps;

  // 1) Opt-out por keyword (match exato).
  if (isOptOutKeyword(message.text)) {
    await ports.optOutContact(message.workspaceId, message.contactId, 'KEYWORD_STOP');
    await ports.sendOptOutConfirmation(message);
    logger.info('campaigns-inbound: opt-out por keyword', {
      contactId: message.contactId,
    });
    return { kind: 'opted_out' };
  }

  // 2) Reply handling — so se houve delivery recente (janela 7d).
  const delivery = await ports.findRecentDelivery(message);
  if (!delivery) {
    return { kind: 'no_op' };
  }

  await ports.markRecipientResponded(message.workspaceId, delivery.recipientId);

  // `handedOff` reflete o que aconteceu com a IA, não a intenção da campanha: a
  // trava de origem pode recusar (conversa sem origem comprovada).
  let handedOff = false;
  if (delivery.autoHandoffOnReply && delivery.aiHandoffAgentId) {
    const handoff = await ports.handoffToAgent(message, delivery.aiHandoffAgentId);
    handedOff = handoff.applied;
  }

  if (delivery.hasOnReplyFollowup) {
    await ports.publishFollowup({
      workspaceId: message.workspaceId,
      campaignId: delivery.campaignId,
      recipientId: delivery.recipientId,
      event: 'on_reply',
    });
  }

  logger.info('campaigns-inbound: reply de campanha tratado', {
    campaignId: delivery.campaignId,
    recipientId: delivery.recipientId,
    handedOff,
  });
  return { kind: 'reply_handled', campaignId: delivery.campaignId, handedOff };
}
