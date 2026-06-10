/** Tipos da feature de pipeline/kanban (F5-S09). Espelham os contratos da API
 * (F5-S04/S05). custom_fields são jsonb genéricos. */
export interface Stage {
  id: string;
  pipelineId: string;
  name: string;
  color: string;
  icon: string | null;
  position: number;
  isWon: boolean;
  isLost: boolean;
  probability: string | null;
  automationRules: unknown[];
  transitionRules: TransitionRules;
}

export interface TransitionRules {
  allowedFromStageIds?: string[];
  requiredFields?: string[];
  requiredRoles?: string[];
  requiresApproval?: boolean;
}

export interface Pipeline {
  id: string;
  name: string;
  description: string | null;
  industry: string | null;
  isDefault: boolean;
  isActive: boolean;
  settings: { custom_fields?: unknown[] };
}

export interface Deal {
  id: string;
  pipelineId: string;
  stageId: string;
  contactId: string;
  title: string;
  valueCents: number;
  currency: string;
  ownerId: string | null;
  position: number;
  customFields: Record<string, unknown>;
  closedAt: string | null;
  closedWon: boolean | null;
}

export interface CreateDealInput {
  pipelineId: string;
  stageId: string;
  contactId: string;
  title: string;
  valueCents?: number;
}
