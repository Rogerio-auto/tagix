/** Tipos da feature de lista de flows (F4-S09). Espelham o contrato da API F4-S08. */

export type FlowStatus = 'draft' | 'active' | 'paused' | 'archived';

export type FlowTriggerType =
  | 'manual'
  | 'stage_change'
  | 'tag_added'
  | 'keyword'
  | 'new_lead'
  | 'new_message'
  | 'system_event'
  | 'flow_submission';

export interface Flow {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: FlowStatus;
  triggerType: FlowTriggerType;
  triggerConfig: Record<string, unknown>;
  channelIds: string[] | null;
  manualPosition: number | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface CreateFlowInput {
  name: string;
  description?: string | null;
  triggerType: FlowTriggerType;
}

export interface ManualOrderItem {
  id: string;
  manualPosition: number;
}
