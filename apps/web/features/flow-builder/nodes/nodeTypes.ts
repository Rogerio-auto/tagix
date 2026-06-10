'use client';

/**
 * Registry de nodeTypes do canvas @xyflow/react (FLOW_BUILDER secao 9.2). DONO de S10
 * (scaffold-then-fill): mapeia cada um dos 15 kinds ao componente de node. S11 preenche
 * as pastas nodes/<tipo>/ — este registry nao muda.
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
};
