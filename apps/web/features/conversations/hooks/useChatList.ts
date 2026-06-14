'use client';

import { useMemo, useState } from 'react';
import { useConversations } from '../queries';
import type { ConversationFilters, ConversationSummary } from '../types';
import { useDebouncedValue } from './useDebouncedValue';
import { useConversationSocket } from './useConversationSocket';

export interface ChatListFilterState {
  status: string;
  assigned: string;
  provider: string;
  search: string;
  /** F30-S10: filtro por departamento (ID). Mapeado para query param `dept`. */
  dept: string;
  /** F30-S10: filtro por time (ID). Mapeado para query param `team`. */
  team: string;
}

export const CHAT_LIST_INITIAL_FILTERS: ChatListFilterState = {
  status: '',
  assigned: '',
  provider: '',
  search: '',
  dept: '',
  team: '',
};

function timeOf(conv: ConversationSummary): number {
  if (!conv.lastMessageAt) return 0;
  const t = Date.parse(conv.lastMessageAt);
  return Number.isNaN(t) ? 0 : t;
}

/** Ordena por atividade mais recente; conversas sem mensagem vão para o fim. */
function byRecency(a: ConversationSummary, b: ConversationSummary): number {
  return timeOf(b) - timeOf(a);
}

/**
 * Projeta o estado de filtros local para o contrato `ConversationFilters` da query.
 * Campos `dept` e `team` (F30-S10) são query params de escopo de visibilidade aceitos
 * pelo GET /api/conversations do S07 — adicionados com intersecção de tipo para não
 * modificar `ConversationFilters` fora do `files_allowed` deste slot.
 */
function toFilters(
  state: ChatListFilterState,
  search: string,
): ConversationFilters & { dept?: string; team?: string } {
  const filters: ConversationFilters & { dept?: string; team?: string } = {};
  if (state.status) filters.status = state.status;
  if (state.assigned) filters.assigned = state.assigned;
  if (state.provider) filters.provider = state.provider;
  // F30-S10: escopo de visibilidade — repassados como query params ao GET escopado (S07).
  if (state.dept) filters.dept = state.dept;
  if (state.team) filters.team = state.team;
  if (search.trim()) filters.search = search.trim();
  return filters;
}

export interface UseChatListResult {
  filters: ChatListFilterState;
  setFilter: <K extends keyof ChatListFilterState>(key: K, value: ChatListFilterState[K]) => void;
  resetFilters: () => void;
  hasActiveFilters: boolean;
  /** `true` enquanto o termo digitado ainda não virou query (debounce em voo). */
  isDebouncing: boolean;
  conversations: ConversationSummary[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * Estado + dados da ChatList: filtros controlados, busca com debounce,
 * ordenação por recência e atualização em tempo real via socket.
 *
 * Reaproveita a query `useConversations(filters)` do slot F1-S13 (não cria
 * query nova). O socket apenas invalida o cache dessa query.
 */
export function useChatList(): UseChatListResult {
  const [filters, setFilters] = useState<ChatListFilterState>(CHAT_LIST_INITIAL_FILTERS);
  const debouncedSearch = useDebouncedValue(filters.search, 300);

  const queryFilters = useMemo(
    () => toFilters(filters, debouncedSearch),
    [filters, debouncedSearch],
  );

  const query = useConversations(queryFilters);
  useConversationSocket();

  const conversations = useMemo(() => {
    const list = query.data?.conversations ?? [];
    return [...list].sort(byRecency);
  }, [query.data]);

  const setFilter = <K extends keyof ChatListFilterState>(
    key: K,
    value: ChatListFilterState[K],
  ): void => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const resetFilters = (): void => setFilters(CHAT_LIST_INITIAL_FILTERS);

  const hasActiveFilters = Boolean(
    filters.status || filters.assigned || filters.provider || filters.search ||
    filters.dept || filters.team,
  );

  return {
    filters,
    setFilter,
    resetFilters,
    hasActiveFilters,
    isDebouncing: filters.search !== debouncedSearch,
    conversations,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}
