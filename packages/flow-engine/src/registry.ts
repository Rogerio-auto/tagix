/**
 * Registry dos 15 handlers de node (FLOW_BUILDER.md §3.3).
 *
 * S02 e DONO deste arquivo (scaffold-then-fill): os slots de handler (F4-S04/05/06)
 * preenchem APENAS `handlers/*.handler.ts` — nunca a registry. `FlowNodeType` deriva
 * das chaves; `satisfies` garante cobertura exaustiva dos 15 tipos em compile-time.
 */
import { triggerHandler } from './handlers/trigger.handler';
import { messageHandler } from './handlers/message.handler';
import { interactiveHandler } from './handlers/interactive.handler';
import { metaFlowHandler } from './handlers/meta-flow.handler';
import { waitHandler } from './handlers/wait.handler';
import { waitForResponseHandler } from './handlers/wait-for-response.handler';
import { conditionHandler } from './handlers/condition.handler';
import { switchHandler } from './handlers/switch.handler';
import { aiActionHandler } from './handlers/ai-action.handler';
import { addTagHandler } from './handlers/add-tag.handler';
import { removeTagHandler } from './handlers/remove-tag.handler';
import { moveStageHandler } from './handlers/move-stage.handler';
import { changeStatusHandler } from './handlers/change-status.handler';
import { httpRequestHandler } from './handlers/http-request.handler';
import { externalNotifyHandler } from './handlers/external-notify.handler';
import type { FlowExecutionContext, FlowHandlerResult, RegisteredFlowHandler } from './types';

export const handlerRegistry = {
  trigger: triggerHandler,
  message: messageHandler,
  interactive: interactiveHandler,
  wait: waitHandler,
  wait_for_response: waitForResponseHandler,
  condition: conditionHandler,
  switch: switchHandler,
  ai_action: aiActionHandler,
  add_tag: addTagHandler,
  remove_tag: removeTagHandler,
  move_stage: moveStageHandler,
  change_status: changeStatusHandler,
  http_request: httpRequestHandler,
  external_notify: externalNotifyHandler,
  meta_flow: metaFlowHandler,
} as const;

// Garantia em compile-time de que TODO valor da registry e um handler (schema+execute),
// sem impor variancia do dado (cada handler ja e tipado no proprio arquivo).
type HandlerShape = {
  readonly schema: { parse: (data: unknown) => unknown };
  execute: (node: never, ctx: FlowExecutionContext) => Promise<FlowHandlerResult>;
};
const _registryCheck: Record<keyof typeof handlerRegistry, HandlerShape> = handlerRegistry;
void _registryCheck;

/** Uniao literal dos 15 tipos de node suportados. */
export type FlowNodeType = keyof typeof handlerRegistry;

/** Resolve o handler de um node.type, ou `undefined` se desconhecido. */
/** View apagada da registry (dispatcher chama via RegisteredFlowHandler). */
const erasedRegistry = handlerRegistry as unknown as Record<string, RegisteredFlowHandler>;

export function getHandler(nodeType: string): RegisteredFlowHandler | undefined {
  return erasedRegistry[nodeType];
}

/** Os 15 tipos como array (UI/validacao). */
export const FLOW_NODE_TYPES = Object.keys(handlerRegistry) as FlowNodeType[];
