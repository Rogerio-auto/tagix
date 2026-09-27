/**
 * Trava de origem da IA nos caminhos automáticos do inbound (F70-S07).
 *
 * O handoff de campanha (`campaigns-inbound`, F6-S07) liga a IA quando o
 * destinatário responde. É um caminho AUTOMÁTICO — nenhum humano decide por
 * conversa —, então passa pela mesma trava do flow `ai_action`: o port de outbound
 * da flow-engine, cujo `setConversationAi('on')` é um UPDATE condicional no predicado
 * único da trava (`aiOriginGateSql`: configuração do workspace, F70-S30, e `origin`;
 * atômico, fail-closed). Com a trava ligada, conversa sem origem comprovada fica com a
 * IA desligada e a recusa é registrada; com ela desligada, o handoff liga a IA.
 *
 * Mora aqui (composição do inbound) porque é aqui que o processor de campanhas é
 * montado; o processor em si não muda.
 */
import type { FlowOutboundPort } from '@hm/flow-engine';
import type { Logger } from '@hm/logger';
import type {
  CampaignInboundPorts,
  HandoffResult,
  InboundMessage,
} from '../campaigns-inbound/processor';

/** Só a mutação de IA do port de outbound da engine. */
export type AiActivationPort = Pick<FlowOutboundPort, 'setConversationAi'>;

/** Envolve os ports de campanha: o handoff para o agente passa pela trava de origem. */
export function gateCampaignAiHandoff(
  ports: CampaignInboundPorts,
  ai: AiActivationPort,
  logger: Logger,
): CampaignInboundPorts {
  return {
    ...ports,
    async handoffToAgent(message: InboundMessage, agentId: string): Promise<HandoffResult> {
      const result = await ai.setConversationAi(message.workspaceId, {
        conversationId: message.conversationId,
        aiMode: 'on',
        agentId,
      });
      if (!result.applied) {
        logger.warn('inbound: handoff de campanha para IA recusado pela trava de origem', {
          workspaceId: message.workspaceId,
          conversationId: message.conversationId,
          reason: result.reason,
        });
      }
      // F70-S13: a recusa sobe até o processor (`handedOff: false`).
      return { applied: result.applied };
    },
  };
}
