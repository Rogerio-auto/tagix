'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import { useAuthStore } from '@/shared/stores/auth.store';
import type { ConversationSummary } from '@/features/conversations/types';

/** Soma de não lidas de uma lista de conversas (negativos e lixo viram 0). */
export function sumUnread(
  conversations: readonly Pick<ConversationSummary, 'unreadCount'>[],
): number {
  return conversations.reduce(
    (acc, c) => acc + (Number.isFinite(c.unreadCount) && c.unreadCount > 0 ? c.unreadCount : 0),
    0,
  );
}

/** Texto curto do selo: some em 0, "99+" acima de 99. */
export function unreadBadgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

/**
 * Não lidas da Inbox para o selo da nav. Compartilha a chave `['conversations', {}]`
 * com a lista sem filtro (o socket já invalida `['conversations']`, então o selo
 * acompanha o tempo real sem polling próprio). Falha silenciosa: sem selo, nunca
 * um erro na casca.
 */
export function useInboxUnread(): number {
  const authed = useAuthStore((s) => s.auth !== null);
  const { data } = useQuery({
    queryKey: ['conversations', {}],
    queryFn: () => api.get<{ conversations: ConversationSummary[] }>('/api/conversations'),
    enabled: authed,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  return data ? sumUnread(data.conversations) : 0;
}
