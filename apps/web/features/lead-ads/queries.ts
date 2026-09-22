'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { LeadSourcesResponse } from './types';

const KEY = ['meta', 'lead-sources'] as const;

export function useLeadSources() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<LeadSourcesResponse>('/api/meta/lead-sources'),
    // Os leads recentes mudam enquanto a campanha roda: a tela se atualiza sozinha.
    refetchInterval: 30_000,
  });
}

export function useSubscribeLeadPage() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { connectionId: string; pageId: string }>({
    mutationFn: (input) => api.post('/api/meta/lead-sources', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Tenta assinar de novo a página que ficou em modo conferência (F69-S13). */
export function useRetrySubscribeLeadPage() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (id) => api.post(`/api/meta/lead-sources/${id}/subscribe`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useStopLeadPage() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (id) => api.delete(`/api/meta/lead-sources/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
