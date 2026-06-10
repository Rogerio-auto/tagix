'use client';

import { MessageSquare, SearchX } from 'lucide-react';
import { Button } from '@hm/ui';
import { EmptyState, ErrorState, SkeletonList } from '@/shared/components/feedback';
import { useChatList } from '../../hooks/useChatList';
import { ChatListFilters } from './ChatListFilters';
import { ChatListItem } from './ChatListItem';

export interface ChatListProps {
  /** Conversa atualmente aberta (destaca o item ativo). */
  activeConversationId?: string;
}

/**
 * Lista de conversas do inbox: filtros (status/responsável/canal), busca com
 * debounce, ordenação por recência, contadores de não-lidas e atualização em
 * tempo real via socket (LIVECHAT.md §6).
 *
 * Cobre os três estados de toda lista (UX): loading (skeleton), empty (vazio vs
 * sem-resultados), error (3 partes + retry).
 */
export function ChatList({ activeConversationId }: ChatListProps) {
  const {
    filters,
    setFilter,
    resetFilters,
    hasActiveFilters,
    isDebouncing,
    conversations,
    isLoading,
    isError,
    refetch,
  } = useChatList();

  const showSkeleton = isLoading || isDebouncing;
  const isEmpty = !showSkeleton && !isError && conversations.length === 0;

  return (
    <div className="flex h-full flex-col">
      <ChatListFilters
        filters={filters}
        onChange={setFilter}
        hasActiveFilters={hasActiveFilters}
        onReset={resetFilters}
      />

      <div className="flex-1 overflow-y-auto">
        {isError ? (
          <ErrorState
            title="Não foi possível carregar as conversas"
            reason="A conexão com o servidor falhou."
            whatToDo="Verifique sua conexão e tente novamente."
            action={
              <Button variant="secondary" onClick={refetch}>
                Tentar de novo
              </Button>
            }
          />
        ) : showSkeleton ? (
          <div className="p-3">
            <SkeletonList rows={6} />
          </div>
        ) : isEmpty ? (
          hasActiveFilters ? (
            <EmptyState
              icon={SearchX}
              title="Nenhum resultado"
              description="Nenhuma conversa corresponde aos filtros aplicados."
              action={
                <Button variant="secondary" onClick={resetFilters}>
                  Limpar filtros
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={MessageSquare}
              title="Nenhuma conversa"
              description="Conecte um canal para começar a receber mensagens."
            />
          )
        ) : (
          <ul aria-label="Conversas" aria-live="polite">
            {conversations.map((conv) => (
              <ChatListItem
                key={conv.id}
                conversation={conv}
                active={conv.id === activeConversationId}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
