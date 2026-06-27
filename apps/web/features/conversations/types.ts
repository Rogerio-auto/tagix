/** Tipos do inbox no frontend (correspondem ao retorno JSON da API @hm/api). */

import type { AiMode } from '@hm/shared';
import type { ContactAddress } from '@/features/contacts/types';

/**
 * Card (deal) vinculado à conversa — read-through do cadastro vivo (F47-S04).
 * Exposto por GET /api/conversations/:id; `null` quando não há deal ligado.
 */
export interface ConversationDeal {
  id: string;
  stageId: string;
  stageName: string | null;
  valueCents: number;
  currency: string;
  closedAt: string | null;
  closedWon: boolean | null;
}

/**
 * Cadastro vivo do contato exposto no detalhe da conversa (F47-S04). Subset do
 * contato com os campos que o Cockpit consome direto (read-through).
 */
export interface ConversationContact {
  id: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  document: string | null;
  address: ContactAddress;
  customFields: Record<string, unknown>;
}

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
  /** Card (deal) vinculado à conversa — read-through (F47-S04). `null` se não há. */
  deal: ConversationDeal | null;
  /** Cadastro vivo do contato — read-through (F47-S04). `null` se conversa sem contato. */
  contact: ConversationContact | null;
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
  /**
   * F52-S07: flag CLIENT-ONLY de falha definitiva no download da mídia inbound.
   * Não vem do servidor — é setada localmente ao receber o evento de socket
   * `message:media_failed` (o worker esgotou as tentativas). A UI troca o
   * placeholder "carregando" por um estado de erro acionável. Limpa sozinha no
   * próximo refetch (`message:media_ready` invalida → servidor reidrata sem ela).
   */
  mediaFailed?: boolean;
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
