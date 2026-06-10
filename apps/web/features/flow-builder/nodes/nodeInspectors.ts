'use client';

/**
 * Registry de inspectors por tipo de node (F4-S11). Consumido pelo InspectorPanel (S10)
 * para renderizar o form de configuracao do node selecionado.
 */
import { TriggerInspector } from './trigger/TriggerInspector';
import { MessageInspector } from './message/MessageInspector';
import { InteractiveInspector } from './interactive/InteractiveInspector';
import { MetaFlowInspector } from './meta_flow/MetaFlowInspector';
import { WaitInspector } from './wait/WaitInspector';
import { WaitForResponseInspector } from './wait_for_response/WaitForResponseInspector';
import { ConditionInspector } from './condition/ConditionInspector';
import { SwitchInspector } from './switch/SwitchInspector';
import { AiActionInspector } from './ai_action/AiActionInspector';
import { AddTagInspector } from './add_tag/AddTagInspector';
import { RemoveTagInspector } from './remove_tag/RemoveTagInspector';
import { MoveStageInspector } from './move_stage/MoveStageInspector';
import { ChangeStatusInspector } from './change_status/ChangeStatusInspector';
import { HttpRequestInspector } from './http_request/HttpRequestInspector';
import { ExternalNotifyInspector } from './external_notify/ExternalNotifyInspector';
import type { FlowNodeKind } from '../shared/node-catalog';

export const nodeInspectors: Record<FlowNodeKind, (props: { nodeId: string }) => React.ReactNode> =
  {
    trigger: TriggerInspector,
    message: MessageInspector,
    interactive: InteractiveInspector,
    meta_flow: MetaFlowInspector,
    wait: WaitInspector,
    wait_for_response: WaitForResponseInspector,
    condition: ConditionInspector,
    switch: SwitchInspector,
    ai_action: AiActionInspector,
    add_tag: AddTagInspector,
    remove_tag: RemoveTagInspector,
    move_stage: MoveStageInspector,
    change_status: ChangeStatusInspector,
    http_request: HttpRequestInspector,
    external_notify: ExternalNotifyInspector,
  };
