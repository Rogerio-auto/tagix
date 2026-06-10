/**
 * Avaliacao e despacho de triggers inbound (FLOW_BUILDER.md secao 5/5.1). Funcoes puras de
 * decisao (`evaluateTrigger`) + orquestracao (`dispatchTriggersForNewMessage`, `resumeWaitingFlows`)
 * sobre as portas injetadas (DB de flows + engine). Determinismo testavel sem infra.
 */
import type { Logger } from '@hm/logger';
import type { ActiveFlow, FlowEnginePort, FlowsQueryPort, InboundMessageInfo } from './types';

/** Tipos de trigger avaliados no caminho inbound (os de evento de mensagem/lead). */
export const INBOUND_TRIGGER_TYPES = [
  'keyword',
  'new_message',
  'new_lead',
  'system_event',
] as const;

/** Triggers deferidos para F5 (dependem de deals/contact_tags). No-op + log. */
export const DEFERRED_TRIGGER_TYPES = ['stage_change', 'tag_added'] as const;

function channelMatches(flow: ActiveFlow, channelId: string): boolean {
  if (!flow.channelIds || flow.channelIds.length === 0) return true;
  return flow.channelIds.includes(channelId);
}

/**
 * Decide se um flow ativo dispara para esta mensagem (PURA). `keyword` casa
 * case-insensitive no conteudo; `new_message` filtra por `message_types`; `new_lead`
 * casa so quando ha contato novo (sinalizado por `message.type`); `system_event` casa pelo
 * `event` no triggerData (avaliado pelo caller via triggerConfig).
 */
export function evaluateTrigger(flow: ActiveFlow, message: InboundMessageInfo): boolean {
  if (!channelMatches(flow, message.channelId)) return false;

  switch (flow.triggerType) {
    case 'keyword': {
      const keyword =
        typeof flow.triggerConfig['keyword'] === 'string'
          ? (flow.triggerConfig['keyword'] as string)
          : '';
      if (!keyword || !message.content) return false;
      return message.content.toLowerCase().includes(keyword.toLowerCase());
    }
    case 'new_message': {
      const types = flow.triggerConfig['message_types'];
      if (Array.isArray(types) && types.length > 0) {
        return types.includes(message.type);
      }
      return true;
    }
    case 'new_lead':
    case 'system_event':
      // new_lead e disparado por outro evento (contato criado); system_event pelo emitter
      // do evento interno. No caminho de mensagem inbound, nao casam por padrao.
      return false;
    default:
      return false;
  }
}

export interface TriggerDispatchDeps {
  readonly flowsQuery: FlowsQueryPort;
  readonly engine: FlowEnginePort;
  readonly logger: Logger;
}

export interface DispatchResult {
  /** Quantos flows foram disparados. */
  readonly triggered: number;
  /** Se houve resume de alguma execucao waiting. */
  readonly resumed: boolean;
}

/**
 * Retoma execucoes em `waiting_for_response` na conversa (FLOW_BUILDER.md secao 4.2). Idempotente:
 * `resumeFlowWithResponse` so age sobre execucoes realmente em waiting com o marker.
 */
export async function resumeWaitingFlows(
  deps: TriggerDispatchDeps,
  message: InboundMessageInfo,
): Promise<boolean> {
  if (!message.fromContact || !message.content) return false;
  await deps.engine.resumeFlowWithResponse({
    conversationId: message.conversationId,
    responseType: 'response',
    responseContent: message.content,
  });
  return true;
}

/**
 * Avalia e dispara triggers para uma nova mensagem inbound (secao 5.1), e tambem retoma flows
 * em espera. So mensagens DO CONTATO disparam/retomam. Chamado pelo pipeline inbound apos
 * persistir a mensagem (gap-fill do orchestrator).
 */
export async function dispatchTriggersForNewMessage(
  deps: TriggerDispatchDeps,
  message: InboundMessageInfo,
): Promise<DispatchResult> {
  if (!message.fromContact) {
    return { triggered: 0, resumed: false };
  }

  // 1) Resume de execucoes aguardando resposta (independente de novos triggers).
  const resumed = await resumeWaitingFlows(deps, message);

  // 2) Avalia flows ativos com trigger de mensagem.
  const flows = await deps.flowsQuery.findActiveByTriggerTypes(message.workspaceId, [
    'keyword',
    'new_message',
  ]);

  let triggered = 0;
  for (const flow of flows) {
    if (!evaluateTrigger(flow, message)) continue;
    await deps.engine.triggerFlow({
      workspaceId: flow.workspaceId,
      flowId: flow.id,
      conversationId: message.conversationId,
      contactId: message.contactId ?? undefined,
      triggerData: { message: message.content, messageType: message.type },
      triggeredBy: 'automatic',
    });
    triggered += 1;
  }

  if (triggered > 0 || resumed) {
    deps.logger.info('flow-triggers: inbound processado', {
      conversationId: message.conversationId,
      triggered,
      resumed,
    });
  }

  return { triggered, resumed };
}

/**
 * Triggers deferidos para F5 (stage_change/tag_added): no-op com log. Mantido como ponto de
 * extensao para quando deals/contact_tags existirem (F5).
 */
export function dispatchDeferredTrigger(
  logger: Logger,
  triggerType: (typeof DEFERRED_TRIGGER_TYPES)[number],
  context: Record<string, unknown> = {},
): void {
  logger.info(`flow-triggers: ${triggerType} deferido ate a F5 (Pipeline)`, {
    triggerType,
    ...context,
  });
}
