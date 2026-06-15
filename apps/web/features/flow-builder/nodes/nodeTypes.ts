'use client';

/**
 * Registry de nodeTypes do canvas @xyflow/react (FLOW_BUILDER secao 9.2). Mapeia cada um
 * dos 22 kinds ao componente de node. As pastas nodes/<tipo>/ trazem a UI rica; F31-S08
 * adiciona register_conversion + 6 kinds novos (stubs preenchidos por S09/S10/S11).
 */
import { TriggerNode } from './trigger/TriggerNode';
import { MessageNode } from './message/MessageNode';
import { InteractiveNode } from './interactive/InteractiveNode';
import { MetaFlowNode } from './meta_flow/MetaFlowNode';
import { WaitNode } from './wait/WaitNode';
import { WaitForResponseNode } from './wait_for_response/WaitForResponseNode';
import { ConditionNode } from './condition/ConditionNode';
import { SwitchNode } from './switch/SwitchNode';
import { AiActionNode } from './ai_action/AiActionNode';
import { AddTagNode } from './add_tag/AddTagNode';
import { RemoveTagNode } from './remove_tag/RemoveTagNode';
import { MoveStageNode } from './move_stage/MoveStageNode';
import { ChangeStatusNode } from './change_status/ChangeStatusNode';
import { HttpRequestNode } from './http_request/HttpRequestNode';
import { ExternalNotifyNode } from './external_notify/ExternalNotifyNode';
import { RegisterConversionNode } from './register_conversion/RegisterConversionNode';
import { SetVariableNode } from './set_variable/SetVariableNode';
import { InputNode } from './input/InputNode';
import { AssignNode } from './assign/AssignNode';
import { TemplateNode } from './template/TemplateNode';
import { AbSplitNode } from './ab_split/AbSplitNode';
import { GoToFlowNode } from './go_to_flow/GoToFlowNode';
import type { NodeTypes } from '@xyflow/react';

export const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  message: MessageNode,
  interactive: InteractiveNode,
  meta_flow: MetaFlowNode,
  wait: WaitNode,
  wait_for_response: WaitForResponseNode,
  condition: ConditionNode,
  switch: SwitchNode,
  ai_action: AiActionNode,
  add_tag: AddTagNode,
  remove_tag: RemoveTagNode,
  move_stage: MoveStageNode,
  change_status: ChangeStatusNode,
  http_request: HttpRequestNode,
  external_notify: ExternalNotifyNode,
  register_conversion: RegisterConversionNode,
  set_variable: SetVariableNode,
  input: InputNode,
  assign: AssignNode,
  template: TemplateNode,
  ab_split: AbSplitNode,
  go_to_flow: GoToFlowNode,
};
