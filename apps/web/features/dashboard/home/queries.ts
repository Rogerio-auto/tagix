'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { HomePayload, HomePeriodDays } from './types';

export const homeKeys = {
  /** Prefixo: invalida a Home de todas as janelas (socket, ações da fila). */
  all: ['dashboard', 'home'] as const,
  period: (days: HomePeriodDays) => ['dashboard', 'home', days] as const,
};

/** Sem socket o número envelhece; o intervalo é a rede de segurança, não o caminho feliz. */
const REFETCH_MS = 60_000;

/**
 * Resumo da Home na janela escolhida. Trocar a janela mantém os números anteriores na
 * tela até os novos chegarem (`keepPreviousData`): sem piscar skeleton nem saltar
 * layout; a tela sinaliza a troca pelo `isPlaceholderData`.
 */
export function useHome(days: HomePeriodDays) {
  return useQuery<HomePayload>({
    queryKey: homeKeys.period(days),
    queryFn: () => api.get<HomePayload>(`/api/dashboard/home?period=${days}d`),
    placeholderData: keepPreviousData,
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}
