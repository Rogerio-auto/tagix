/**
 * Registry dos 22 handlers de node (FLOW_BUILDER.md §3.3).
 *
 * S02 e DONO deste arquivo (scaffold-then-fill): os slots de handler preenchem APENAS
 * `handlers/*.handler.ts` — nunca a registry. `FlowNodeType` deriva das chaves; o check
 * `Record` garante cobertura exaustiva dos 22 tipos em compile-time. Os 6 kinds novos
 * (set_variable/input/assign/template/ab_split/go_to_flow) entram como stubs na F31-S08;
 * S09/S10/S11 preenchem a logica real.
 */
import { triggerHandler } from './handlers/trigger.handler';
import { messageHandler } from './handlers/message.handler';
import { interactiveHandler } from './handlers/interactive.handler';
import { metaFlowHandler } from './handlers/meta_flow.handler';
import { waitHandler } from './handlers/wait.handler';
import { waitForResponseHandler } from './handlers/wait_for_response.handler';
import { conditionHandler } from './handlers/condition.handler';
import { switchHandler } from './handlers/switch.handler';
import { aiActionHandler } from './handlers/ai_action.handler';
import { addTagHandler } from './handlers/add_tag.handler';
import { removeTagHandler } from './handlers/remove_tag.handler';
import { moveStageHandler } from './handlers/move_stage.handler';
import { registerConversionHandler } from './handlers/register_conversion.handler';
import { changeStatusHandler } from './handlers/change_status.handler';
import { httpRequestHandler } from './handlers/http_request.handler';
import { externalNotifyHandler } from './handlers/external_notify.handler';
import { setVariableHandler } from './handlers/set_variable.handler';
import { inputHandler } from './handlers/input.handler';
import { assignHandler } from './handlers/assign.handler';
import { templateHandler } from './handlers/template.handler';
import { abSplitHandler } from './handlers/ab_split.handler';
import { goToFlowHandler } from './handlers/go_to_flow.handler';
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
  register_conversion: registerConversionHandler,
  change_status: changeStatusHandler,
  http_request: httpRequestHandler,
  external_notify: externalNotifyHandler,
  meta_flow: metaFlowHandler,
  set_variable: setVariableHandler,
  input: inputHandler,
  assign: assignHandler,
  template: templateHandler,
  ab_split: abSplitHandler,
  go_to_flow: goToFlowHandler,
} as const;

// Garantia em compile-time de que TODO valor da registry e um handler (schema+execute),
// sem impor variancia do dado (cada handler ja e tipado no proprio arquivo).
type HandlerShape = {
  readonly schema: { parse: (data: unknown) => unknown };
  execute: (node: never, ctx: FlowExecutionContext) => Promise<FlowHandlerResult>;
};
const _registryCheck: Record<keyof typeof handlerRegistry, HandlerShape> = handlerRegistry;
void _registryCheck;

/** Uniao literal dos 22 tipos de node suportados. */
export type FlowNodeType = keyof typeof handlerRegistry;

/** Resolve o handler de um node.type, ou `undefined` se desconhecido. */
/** View apagada da registry (dispatcher chama via RegisteredFlowHandler). */
const erasedRegistry = handlerRegistry as unknown as Record<string, RegisteredFlowHandler>;

export function getHandler(nodeType: string): RegisteredFlowHandler | undefined {
  return erasedRegistry[nodeType];
}

/** Os 22 tipos como array (UI/validacao). */
export const FLOW_NODE_TYPES = Object.keys(handlerRegistry) as FlowNodeType[];
