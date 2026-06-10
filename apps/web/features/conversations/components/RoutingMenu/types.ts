/** Tipos do roteamento de conversas (F1-S23) — espelham o JSON da API @hm/api. */

/** Ação registrada na trilha de roteamento (`routing_history.action`). */
export type RoutingAction =
  | 'assign'
  | 'unassign'
  | 'transfer_member'
  | 'transfer_department'
  | 'auto_assign';

/** Linha imutável da trilha de roteamento de uma conversa. */
export interface RoutingHistoryEntry {
  id: string;
  conversationId: string;
  action: RoutingAction;
  fromMemberId: string | null;
  toMemberId: string | null;
  fromDepartment: string | null;
  toDepartment: string | null;
  reason: string | null;
  actorMemberId: string | null;
  createdAt: string;
}

/** Membro elegível para atribuição/transferência. Subconjunto de `members`. */
export interface AssignableMember {
  id: string;
  name: string | null;
  email: string;
  avatarUrl?: string | null;
}

/** Department elegível como destino de transferência. */
export interface RoutingDepartment {
  id: string;
  name: string;
}

export interface AssignInput {
  conversationId: string;
  memberId: string;
}

export interface TransferInput {
  conversationId: string;
  /** Novo owner (`undefined` = não altera; `null` = remove atribuição). */
  memberId?: string | null;
  /** Novo department (`undefined` = não altera; `null` = remove). */
  departmentId?: string | null;
  reason?: string;
}
