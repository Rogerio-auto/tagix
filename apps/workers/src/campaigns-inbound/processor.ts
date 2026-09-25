/**
 * Conecta mensagens inbound as campanhas (CAMPAIGNS.md 8.3 + 9.3). Self-contained,
 * via PORTS injetadas (DB/MQ) — testavel sem broker/DB reais.
 *
 * Ao processar uma mensagem inbound text de um contato:
 *  1) OPT-OUT por keyword (match EXATO, optout.ts): opta o contato out + remove
 *     de campanhas MARKETING futuras + envia confirmacao automatica. Para aqui
 *     (nao trata como reply de campanha).
 *  2) REPLY handling: se houve delivery recente desse contato (janela 7d), marca
 *     o recipient como responded (e, com followup on_reply, grava o followup junto),
 *     e faz AI handoff se a campanha tiver auto_handoff_on_reply + ai_handoff_agent_id.
 *
 * F70-S25: o que sai para uma fila nasce na transacao do dado que o motiva — a
 * confirmacao de opt-out (mensagem `pending` real + job) com o opt-out, o followup
 * `on_reply` com a marca de resposta. Por isso as portas juntam as duas coisas.
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
  /**
   * Opta o contato out, tira de campanhas MARKETING (regra do optOutContact da API) e
   * grava a confirmacao automatica ao contato (mensagem `pending` + job de envio), tudo na
   * MESMA transacao.
   */
  optOutContact(message: InboundMessage, reason: string): Promise<void>;
  /** Delivery mais recente do contato na janela de 7d (ou null). */
  findRecentDelivery(message: InboundMessage): Promise<RecentDelivery | null>;
  /**
   * Marca o recipient como respondido. Com `onReplyFollowup`, grava na MESMA transacao o
   * evento de followup `on_reply` (duravel via scheduled_followups, F6-S06).
   */
  markRecipientResponded(
    workspaceId: string,
    recipientId: string,
    onReplyFollowup: { readonly campaignId: string } | null,
  ): Promise<void>;
  /** Tenta ligar a IA na conversa com o agente da campanha; devolve se ligou de fato. */
  handoffToAgent(message: InboundMessage, agentId: string): Promise<HandoffResult>;
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
    await ports.optOutContact(message, 'KEYWORD_STOP');
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

  await ports.markRecipientResponded(
    message.workspaceId,
    delivery.recipientId,
    delivery.hasOnReplyFollowup ? { campaignId: delivery.campaignId } : null,
  );

  // `handedOff` reflete o que aconteceu com a IA, não a intenção da campanha: a
  // trava de origem pode recusar (conversa sem origem comprovada).
  let handedOff = false;
  if (delivery.autoHandoffOnReply && delivery.aiHandoffAgentId) {
    const handoff = await ports.handoffToAgent(message, delivery.aiHandoffAgentId);
    handedOff = handoff.applied;
  }

  logger.info('campaigns-inbound: reply de campanha tratado', {
    campaignId: delivery.campaignId,
    recipientId: delivery.recipientId,
    handedOff,
  });
  return { kind: 'reply_handled', campaignId: delivery.campaignId, handedOff };
}
