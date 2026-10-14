'use client';

/**
 * Dados da fila de espera e da agenda do dia na Home. Mesma rota da antiga tela
 * "Hoje" (`/api/dashboard/today`); a chave de cache é mantida para que as ações
 * (Depois/Perdido) e o socket invalidem o que já invalidavam.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { TodayPayload } from './types';

export const todayKeys = {
  all: ['dashboard', 'today'] as const,
};

/** O dono deixa a tela aberta: atualizar sozinho evita ler um número velho. */
const REFETCH_MS = 60_000;

export function useToday() {
  return useQuery<TodayPayload>({
    queryKey: todayKeys.all,
    queryFn: () => api.get<TodayPayload>('/api/dashboard/today'),
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
  });
}

/** Ações sobre um lead da fila. Ambas invalidam fila, Home e lista de conversas. */
export function useWaitingActions() {
  const qc = useQueryClient();
  const invalidar = (): void => {
    void qc.invalidateQueries({ queryKey: todayKeys.all });
    void qc.invalidateQueries({ queryKey: ['dashboard', 'home'] });
    // A lista de conversas mostra as mesmas conversas; deixá-la velha faria o lead
    // reaparecer como aberto na outra tela.
    void qc.invalidateQueries({ queryKey: ['conversations'] });
  };

  /** Adia para amanhã de manhã: sai da fila e volta quando dá para agir. */
  const depois = useMutation({
    mutationFn: (conversationId: string) => {
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      amanha.setHours(8, 0, 0, 0);
      return api.post(`/api/conversations/${conversationId}/status`, {
        status: 'snoozed',
        snoozedUntil: amanha.toISOString(),
      });
    },
    onSettled: invalidar,
  });

  /** Uma chamada: fecha o card como perdido e resolve a conversa. */
  const perdido = useMutation({
    mutationFn: (conversationId: string) =>
      api.post(`/api/dashboard/today/${conversationId}/lost`, {}),
    onSettled: invalidar,
  });

  return { depois, perdido };
}
