/** Tipos do inbox no frontend (correspondem ao retorno JSON da API @hm/api). */

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
}

export interface ConversationFilters {
  status?: string;
  assigned?: string;
  provider?: string;
  search?: string;
}
