'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, SearchX } from 'lucide-react';
import { Button } from '@hm/ui';
import { EmptyState, ErrorState, SkeletonList } from '@/shared/components/feedback';
import { useChatList } from '../../hooks/useChatList';
import { useDepartments, useTeams } from '@/features/settings/sections/workspace-org/queries';
import { ChatListFilters } from './ChatListFilters';
import { ChatListItem } from './ChatListItem';
import { nextFocusIndex } from './rovingNav';
import { homonymIds } from './homonyms';
import { unreadSummary } from './liveSummary';

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

  // Homonimos (F72-S05): quando dois contatos mostram o mesmo nome, o telefone vira a
  // 2a linha de ambos (e o que os diferencia). Contagem por rotulo normalizado.
  const homonyms = useMemo(() => homonymIds(conversations), [conversations]);

  // Região viva (UX §3): anuncia só o RESUMO, nunca a lista de links. O texto é uma
  // string derivada da contagem; o leitor de tela só fala quando ela muda — mensagens
  // novas numa conversa já não lida, reordenação ou re-render idêntico ficam mudos.
  const unreadConversations = useMemo(
    () => conversations.filter((c) => c.unreadCount > 0).length,
    [conversations],
  );
  const liveSummary = unreadSummary(unreadConversations);

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

  // Índice efetivo do roving, derivado no render: antes do efeito acima rodar (1º
  // paint, SSR) a lista já tem exatamente um link na ordem de Tab.
  const activeIndex = conversations.findIndex((c) => c.id === activeConversationId);
  const rovingIndex =
    focusedIndex >= 0 && focusedIndex < conversations.length
      ? focusedIndex
      : activeIndex >= 0
        ? activeIndex
        : 0;

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const next = nextFocusIndex(event.key, rovingIndex, conversations.length);
      if (next === null) return;
      event.preventDefault();
      setFocusedIndex(next);
      focusItem(next);
    },
    [conversations.length, rovingIndex, focusItem],
  );

  // Clique ou Tab num link também move o foco lógico (o roving segue o usuário).
  const onFocus = useCallback((event: React.FocusEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLAnchorElement)) return;
    const idx = itemRefs.current.indexOf(target);
    if (idx >= 0) setFocusedIndex(idx);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Sempre montada (antes do conteúdo mudar) para o anúncio funcionar. */}
      <p role="status" className="sr-only">
        {showSkeleton || isError ? '' : liveSummary}
      </p>
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
          // nav + ul de links (sem listbox/option): evita `nested-interactive`. As setas
          // movem o foco entre os links (roving tabindex); Enter segue o link.
          <nav
            aria-label="Conversas"
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            className="px-2 py-1.5"
          >
            <ul className="space-y-0.5">
              {conversations.map((conv, index) => (
                <ChatListItem
                  key={conv.id}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  conversation={conv}
                  active={conv.id === activeConversationId}
                  showPhone={homonyms.has(conv.id)}
                  tabIndex={index === rovingIndex ? 0 : -1}
                  focused={index === rovingIndex}
                />
              ))}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
}
