/** Tipos do inbox no frontend (correspondem ao retorno JSON da API @hm/api). */

import type { AiMode } from '@hm/shared';

export interface ConversationSummary {
  id: string;
  contactId: string | null;
  channelId: string;
  remoteId: string;
  kind: string;
  status: string;
  aiMode: string;
  assignedTo: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  lastMessageFrom: string | null;
  unreadCount: number;
}

/**
 * Detalhe completo de uma conversa, incluindo campos de estado operacional
 * (F30-S03 — cockpit). Subset do schema DB exposto pelo GET /api/conversations/:id.
 */
export interface ConversationDetail {
  id: string;
  contactId: string | null;
  channelId: string;
  /** Provider do canal (whatsapp / instagram / waha). */
  channelProvider: string | null;
  remoteId: string;
  kind: string;
  status: string;
  aiMode: AiMode;
  /** Motivo de pausa da IA ('human_takeover' | 'manual' | null). */
  aiPausedReason: string | null;
  /** ISO timestamp de quando a IA foi pausada. */
  aiPausedAt: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  /** Agente de IA atual da conversa (id + nome) — read-only no cockpit. */
  agentId: string | null;
  agentName: string | null;
  /** Stage do pipeline (exibição de contexto). */
  stageName: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageItem {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  senderType: string;
  type: string;
  content: string | null;
  viewStatus: string;
  mediaUrl: string | null;
  createdAt: string;
  /** F15-S08: id externo (= commentId em mensagens IG type='comment'). Opcional. */
  externalId?: string | null;
  /** F15-S08: metadados IG (mediaId/commentId/parentCommentId). Opcional. */
  metadata?: Record<string, unknown> | null;
}

export interface ConversationFilters {
  status?: string;
  assigned?: string;
  provider?: string;
  search?: string;
  /** F30-S03: filtro por departamento (UUID). */
  department?: string;
  /** F30-S03: filtro por time (UUID). */
  team?: string;
}
