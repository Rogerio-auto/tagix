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

/** Triggers de dominio Pipeline (F5-S16): stage_change/tag_added — agora ATIVOS
 * via dispatchTriggersForStageChange/dispatchTriggersForTagAdded. */
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



/** Contexto de uma mudanca de stage (vinda do seam onStageChanged de F5-S05). */
export interface StageChangeInfo {
  readonly workspaceId: string;
  readonly dealId: string;
  readonly contactId: string | null;
  readonly conversationId?: string | null;
  readonly fromStageId: string;
  readonly toStageId: string;
}

/** Contexto de aplicacao de tag (vinda da aplicacao de tag / trigger pg de F5-S16). */
export interface TagAddedInfo {
  readonly workspaceId: string;
  readonly contactId: string;
  readonly conversationId?: string | null;
  readonly tagId: string;
}

/**
 * Casa um flow `stage_change` (F5-S16). triggerConfig pode filtrar por
 * `from_stage_id`/`to_stage_id` (FLOW_BUILDER §5 tabela). Vazio = qualquer.
 */
export function matchesStageChange(flow: ActiveFlow, info: StageChangeInfo): boolean {
  if (flow.triggerType !== 'stage_change') return false;
  const from = flow.triggerConfig['from_stage_id'];
  const to = flow.triggerConfig['to_stage_id'];
  if (typeof from === 'string' && from && from !== info.fromStageId) return false;
  if (typeof to === 'string' && to && to !== info.toStageId) return false;
  return true;
}

/** Casa um flow `tag_added` (F5-S16). triggerConfig.tag_id filtra a tag; vazio = qualquer. */
export function matchesTagAdded(flow: ActiveFlow, info: TagAddedInfo): boolean {
  if (flow.triggerType !== 'tag_added') return false;
  const tag = flow.triggerConfig['tag_id'];
  if (typeof tag === 'string' && tag && tag !== info.tagId) return false;
  return true;
}

/**
 * Dispara flows `stage_change` para uma mudanca de stage (F5-S16). Chamado pelo
 * seam onStageChanged (gap-fill do orchestrator). Encerra a divida stub-ate-F5.
 */
export async function dispatchTriggersForStageChange(
  deps: TriggerDispatchDeps,
  info: StageChangeInfo,
): Promise<number> {
  const flows = await deps.flowsQuery.findActiveByTriggerTypes(info.workspaceId, ['stage_change']);
  let triggered = 0;
  for (const flow of flows) {
    if (!matchesStageChange(flow, info)) continue;
    await deps.engine.triggerFlow({
      workspaceId: flow.workspaceId,
      flowId: flow.id,
      conversationId: info.conversationId ?? undefined,
      contactId: info.contactId ?? undefined,
      triggerData: {
        dealId: info.dealId,
        fromStageId: info.fromStageId,
        toStageId: info.toStageId,
      },
      triggeredBy: 'automatic',
    });
    triggered += 1;
  }
  if (triggered > 0) {
    deps.logger.info('flow-triggers: stage_change disparado', { dealId: info.dealId, triggered });
  }
  return triggered;
}

/**
 * Dispara flows `tag_added` para a aplicacao de uma tag (F5-S16). Chamado quando
 * uma tag e aplicada ao contato (gap-fill do orchestrator). Encerra stub-ate-F5.
 */
export async function dispatchTriggersForTagAdded(
  deps: TriggerDispatchDeps,
  info: TagAddedInfo,
): Promise<number> {
  const flows = await deps.flowsQuery.findActiveByTriggerTypes(info.workspaceId, ['tag_added']);
  let triggered = 0;
  for (const flow of flows) {
    if (!matchesTagAdded(flow, info)) continue;
    await deps.engine.triggerFlow({
      workspaceId: flow.workspaceId,
      flowId: flow.id,
      conversationId: info.conversationId ?? undefined,
      contactId: info.contactId,
      triggerData: { tagId: info.tagId },
      triggeredBy: 'automatic',
    });
    triggered += 1;
  }
  if (triggered > 0) {
    deps.logger.info('flow-triggers: tag_added disparado', { contactId: info.contactId, triggered });
  }
  return triggered;
}
