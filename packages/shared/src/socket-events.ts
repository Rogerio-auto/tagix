/**
 * Mapa de eventos Server→Client do Socket.io (LIVECHAT.md §6). Tipos PUROS
 * (sem deps node) — fonte única para tipar o servidor e o client.
 *
 * Os objetos de domínio (`Message`, `Conversation`) ainda não estão modelados
 * em @hm/shared; até lá ficam como `unknown` no boundary (validar no consumo).
 * Os demais campos são tipados de forma estrita.
 */

import type { AiMode, AiPausedReason } from './types/inbox';

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

/**
 * Download de mídia inbound falhou em definitivo (F52-S05): o worker esgotou as
 * tentativas (incl. re-resolução de URL expirada) ou o provider confirmou a
 * mídia indisponível. A UI troca o placeholder "carregando" por um estado de
 * erro acionável — nada fica preso carregando. `reason` é diagnóstico
 * (`media_unavailable` | `empty_media`), não destinado ao usuário final.
 */
export interface MessageMediaFailedPayload {
  conversationId: string;
  messageId: string;
  reason: string;
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

/** IA ligada/desligada/pausada/retomada numa conversa (F30 / LIVECHAT_OPS §2). */
export interface ConversationAiModeChangedPayload {
  conversationId: string;
  aiMode: AiMode;
  reason: AiPausedReason | null;
}

/** Mudança de status operacional da conversa (resolver/snooze/reabrir — F30). */
export interface ConversationStateChangedPayload {
  conversationId: string;
  status: string;
}

/**
 * Troca manual do agente de IA que atende a conversa (F34-S04 / AGENT_DEPARTMENT
 * _ROUTING_PLAN D4). `agentName` viaja no payload para o cockpit refletir o nome
 * sem refetch; `null` é defensivo (agente removido entre persistência e relay).
 */
export interface ConversationAgentChangedPayload {
  conversationId: string;
  agentId: string;
  agentName: string | null;
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

/**
 * Mudança de estado de uma execução de flow (F51 — cockpit em tempo real). Emitido pela
 * engine/worker e pelo cancel da API a cada transição relevante (running/waiting/terminal).
 * `conversationId` null = execução sem conversa (cai só na room `ws:{id}`); `nextStepAt` é o
 * deadline do próximo passo quando `waiting` (ISO), senão null.
 */
export interface FlowExecutionUpdatedPayload {
  conversationId: string | null;
  flowId: string;
  executionId: string;
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  nextStepAt: string | null;
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
 * Dashboard realtime (F8-S02 / DASHBOARD.md §5/§8). O servidor reemite o estado
 * operacional (minhas/fila/IA rodando) quando muda. `scope` carrega o recorte
 * (`{ memberId }` p/ métrica pessoal, `{ teamId }`/`{ departmentId }` p/ supervisão);
 * o client invalida a query do dashboard se o evento for relevante ao seu role/escopo.
 * Filtragem por role é server-side (§8): o relay entrega à room do workspace e o
 * client só reage a métricas do seu conjunto — nunca expõe dado fora do role.
 */
export interface DashboardMetricChangedPayload {
  workspaceId: string;
  metricKey: string;
  scope: Record<string, string>;
  newValue: Record<string, unknown>;
}

/**
 * Eventos emitidos do servidor para o client. Cada entrada mapeia o nome do
 * evento → assinatura do listener (convenção Socket.io `EventsMap`).
 */
export interface ServerToClient {
  'message:new': (p: MessageNewPayload) => void;
  'message:status_changed': (p: MessageStatusChangedPayload) => void;
  'message:media_ready': (p: MessageMediaReadyPayload) => void;
  'message:media_failed': (p: MessageMediaFailedPayload) => void;
  'conversation:updated': (p: ConversationUpdatedPayload) => void;
  'conversation:assigned': (p: ConversationAssignedPayload) => void;
  'conversation:routing_changed': (p: ConversationRoutingChangedPayload) => void;
  'conversation:ai_mode_changed': (p: ConversationAiModeChangedPayload) => void;
  'conversation:state_changed': (p: ConversationStateChangedPayload) => void;
  'conversation:agent_changed': (p: ConversationAgentChangedPayload) => void;
  'typing:from_contact': (p: TypingFromContactPayload) => void;
  'note:mentioned': (p: NoteMentionedPayload) => void;
  'agent_execution:started': (p: AgentExecutionPayload) => void;
  'agent_execution:completed': (p: AgentExecutionPayload) => void;
  'flow_execution:started': (p: FlowExecutionPayload) => void;
  'flow_execution:cancelled': (p: FlowExecutionPayload) => void;
  'flow_execution:updated': (p: FlowExecutionUpdatedPayload) => void;
  'deal:created': (p: DealCreatedPayload) => void;
  'deal:updated': (p: DealUpdatedPayload) => void;
  'deal:stage_changed': (p: DealStageChangedPayload) => void;
  'deal:deleted': (p: DealDeletedPayload) => void;
  'pipeline:updated': (p: PipelineUpdatedPayload) => void;
  'dashboard:metric_changed': (p: DashboardMetricChangedPayload) => void;
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
  'message:media_failed',
  'conversation:updated',
  'conversation:assigned',
  'conversation:routing_changed',
  'conversation:ai_mode_changed',
  'conversation:state_changed',
  'conversation:agent_changed',
  'typing:from_contact',
  'note:mentioned',
  'agent_execution:started',
  'agent_execution:completed',
  'flow_execution:started',
  'flow_execution:cancelled',
  'flow_execution:updated',
  'deal:created',
  'deal:updated',
  'deal:stage_changed',
  'deal:deleted',
  'pipeline:updated',
  'dashboard:metric_changed',
] as const satisfies readonly ServerToClientEvent[];
