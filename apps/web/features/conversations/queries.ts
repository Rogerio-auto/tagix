'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { ConversationFilters, ConversationSummary, MessageItem } from './types';

function toQuery(filters: ConversationFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useConversations(filters: ConversationFilters = {}) {
  return useQuery({
    queryKey: ['conversations', filters],
    queryFn: () => api.get<{ conversations: ConversationSummary[] }>(`/api/conversations${toQuery(filters)}`),
  });
}

export function useMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: ['conversation', conversationId, 'messages'],
    queryFn: () => api.get<{ messages: MessageItem[] }>(`/api/conversations/${conversationId}/messages`),
    enabled: Boolean(conversationId),
  });
}
