/**
 * Mapa de eventos Server→Client do Socket.io (LIVECHAT.md §6). Tipos PUROS
 * (sem deps node) — fonte única para tipar o servidor e o client.
 *
 * Os objetos de domínio (`Message`, `Conversation`) ainda não estão modelados
 * em @hm/shared; até lá ficam como `unknown` no boundary (validar no consumo).
 * Os demais campos são tipados de forma estrita.
 */

/** Status de visualização de uma mensagem (LIVECHAT.md §3.1). */
export type ViewStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

/** Presença do contato no chat. */
export type ContactPresence = 'typing' | 'recording';

/** Mudança de roteamento de uma conversa. */
export interface RoutingChange {
  from: string | null;
  to: string | null;
}

// --- Payloads por evento ---

export interface MessageNewPayload {
  workspaceId: string;
  conversationId: string;
  message: unknown;
}

export interface MessageStatusChangedPayload {
  conversationId: string;
  messageId: string;
  status: ViewStatus;
}

export interface MessageMediaReadyPayload {
  conversationId: string;
  messageId: string;
  mediaUrl: string;
}

export interface ConversationUpdatedPayload {
  workspaceId: string;
  conversation: unknown;
}

export interface ConversationAssignedPayload {
  conversationId: string;
  assignedTo: string | null;
}

export interface ConversationRoutingChangedPayload {
  conversationId: string;
  routing: RoutingChange;
}

export interface TypingFromContactPayload {
  conversationId: string;
  presence: ContactPresence;
}

export interface AgentExecutionPayload {
  conversationId: string;
  agentId: string;
  executionId: string;
}

export interface FlowExecutionPayload {
  conversationId: string;
  flowId: string;
  executionId: string;
}

/** Menção `@member` numa nota interna (F1-S22), entregue ao mencionado. */
export interface NoteMentionedPayload {
  conversationId: string;
  noteId: string;
  mentionedMemberId: string;
  authorMemberId: string;
  preview: string;
}

/** Pipeline/Deals real-time (F5-S07 / PIPELINE.md §6.1). */
export interface DealCreatedPayload {
  workspaceId: string;
  deal: unknown;
}

export interface DealUpdatedPayload {
  workspaceId: string;
  deal: unknown;
}

export interface DealStageChangedPayload {
  workspaceId: string;
  dealId: string;
  fromStageId: string;
  toStageId: string;
  movedBy: string;
}

export interface DealDeletedPayload {
  workspaceId: string;
  dealId: string;
}

export interface PipelineUpdatedPayload {
  workspaceId: string;
  pipelineId: string;
}

/**
 * Eventos emitidos do servidor para o client. Cada entrada mapeia o nome do
 * evento → assinatura do listener (convenção Socket.io `EventsMap`).
 */
export interface ServerToClient {
  'message:new': (p: MessageNewPayload) => void;
  'message:status_changed': (p: MessageStatusChangedPayload) => void;
  'message:media_ready': (p: MessageMediaReadyPayload) => void;
  'conversation:updated': (p: ConversationUpdatedPayload) => void;
  'conversation:assigned': (p: ConversationAssignedPayload) => void;
  'conversation:routing_changed': (p: ConversationRoutingChangedPayload) => void;
  'typing:from_contact': (p: TypingFromContactPayload) => void;
  'note:mentioned': (p: NoteMentionedPayload) => void;
  'agent_execution:started': (p: AgentExecutionPayload) => void;
  'agent_execution:completed': (p: AgentExecutionPayload) => void;
  'flow_execution:started': (p: FlowExecutionPayload) => void;
  'flow_execution:cancelled': (p: FlowExecutionPayload) => void;
  'deal:created': (p: DealCreatedPayload) => void;
  'deal:updated': (p: DealUpdatedPayload) => void;
  'deal:stage_changed': (p: DealStageChangedPayload) => void;
  'deal:deleted': (p: DealDeletedPayload) => void;
  'pipeline:updated': (p: PipelineUpdatedPayload) => void;
}

/** Nome de um evento Server→Client. */
export type ServerToClientEvent = keyof ServerToClient;

/** Payload (1º argumento) de um evento Server→Client. */
export type ServerToClientPayload<E extends ServerToClientEvent> = Parameters<ServerToClient[E]>[0];

/** Nomes de evento conhecidos, em runtime (para validação). */
export const SERVER_TO_CLIENT_EVENTS = [
  'message:new',
  'message:status_changed',
  'message:media_ready',
  'conversation:updated',
  'conversation:assigned',
  'conversation:routing_changed',
  'typing:from_contact',
  'note:mentioned',
  'agent_execution:started',
  'agent_execution:completed',
  'flow_execution:started',
  'flow_execution:cancelled',
  'deal:created',
  'deal:updated',
  'deal:stage_changed',
  'deal:deleted',
  'pipeline:updated',
] as const satisfies readonly ServerToClientEvent[];
