'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, SearchX } from 'lucide-react';
import { Button } from '@hm/ui';
import { EmptyState, ErrorState, SkeletonList } from '@/shared/components/feedback';
import { useChatList } from '../../hooks/useChatList';
import { useDepartments, useTeams } from '@/features/settings/sections/workspace-org/queries';
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

  // F30: fontes de dados dos filtros de distribuição (dept/time) — o backend já
  // escopa a lista por visibilidade (S07); aqui só alimentamos os selects (S03/S10).
  const departments = useDepartments().data?.departments ?? [];
  const teams = useTeams().data?.teams ?? [];

  const showSkeleton = isLoading || isDebouncing;
  const isEmpty = !showSkeleton && !isError && conversations.length === 0;

  // Roving tabindex (UX §2.10): ↑/↓ movem o foco entre conversas, Enter abre
  // (o próprio <Link> focado segue a navegação nativamente). `focusedIndex` é o
  // item que detém o tabindex 0; -1 = nenhum foco lógico fixado ainda.
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  // Mantém o índice válido quando a lista muda (filtro/realtime) e ancora no
  // item ativo (conversa aberta) quando existir.
  useEffect(() => {
    if (conversations.length === 0) {
      setFocusedIndex(-1);
      return;
    }
    setFocusedIndex((prev) => {
      if (prev >= 0 && prev < conversations.length) return prev;
      const activeIdx = conversations.findIndex((c) => c.id === activeConversationId);
      return activeIdx >= 0 ? activeIdx : 0;
    });
  }, [conversations, activeConversationId]);

  const focusItem = useCallback((index: number) => {
    const el = itemRefs.current[index];
    if (el) el.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      const count = conversations.length;
      if (count === 0) return;
      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault();
          const next = focusedIndex < 0 ? 0 : Math.min(focusedIndex + 1, count - 1);
          setFocusedIndex(next);
          focusItem(next);
          break;
        }
        case 'ArrowUp': {
          event.preventDefault();
          const next = focusedIndex < 0 ? 0 : Math.max(focusedIndex - 1, 0);
          setFocusedIndex(next);
          focusItem(next);
          break;
        }
        case 'Home': {
          event.preventDefault();
          setFocusedIndex(0);
          focusItem(0);
          break;
        }
        case 'End': {
          event.preventDefault();
          const last = count - 1;
          setFocusedIndex(last);
          focusItem(last);
          break;
        }
        default:
          break;
      }
    },
    [conversations.length, focusedIndex, focusItem],
  );

  return (
    <div className="flex h-full flex-col">
      <ChatListFilters
        filters={filters}
        onChange={setFilter}
        hasActiveFilters={hasActiveFilters}
        onReset={resetFilters}
        departments={departments}
        selectedDept={filters.dept}
        onDeptChange={(deptId) => setFilter('dept', deptId)}
        teams={teams}
        selectedTeam={filters.team}
        onTeamChange={(teamId) => setFilter('team', teamId)}
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
          <ul
            role="listbox"
            aria-label="Conversas"
            aria-live="polite"
            tabIndex={focusedIndex < 0 ? 0 : -1}
            onKeyDown={onKeyDown}
            onFocus={(e) => {
              // Foco entrou no <ul> vazio de roving (sem item focável ainda):
              // delega ao primeiro item para o teclado fluir.
              if (e.target === e.currentTarget && conversations.length > 0) {
                const idx = focusedIndex < 0 ? 0 : focusedIndex;
                setFocusedIndex(idx);
                focusItem(idx);
              }
            }}
            className="outline-none"
          >
            {conversations.map((conv, index) => (
              <ChatListItem
                key={conv.id}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                conversation={conv}
                active={conv.id === activeConversationId}
                tabIndex={index === focusedIndex ? 0 : -1}
                focused={index === focusedIndex}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
