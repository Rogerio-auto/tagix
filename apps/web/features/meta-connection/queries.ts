'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { MetaConnectionView, MetaUseCaseId, MetaUseCaseOption } from './types';

const CONNECTIONS_KEY = ['meta', 'connections'] as const;

export function useMetaUseCases() {
  return useQuery({
    queryKey: ['meta', 'use-cases'],
    queryFn: () => api.get<{ useCases: MetaUseCaseOption[] }>('/api/meta/use-cases'),
    staleTime: 60 * 60 * 1000,
  });
}

export function useMetaConnections() {
  return useQuery({
    queryKey: CONNECTIONS_KEY,
    queryFn: () => api.get<{ connections: MetaConnectionView[] }>('/api/meta/connections'),
  });
}

/** Troca o `code` do login por uma conexão. O token nunca passa pelo navegador. */
export function useCreateMetaConnection() {
  const qc = useQueryClient();
  return useMutation<
    { connection: MetaConnectionView },
    Error,
    { code: string; useCases: MetaUseCaseId[] }
  >({
    mutationFn: (input) =>
      api.post<{ connection: MetaConnectionView }>('/api/meta/connections', {
        ...input,
        // F69-S12: a Meta recusa a troca do código com `100/36008` ("redirect_uri is identical…").
        // A URL desta página é a candidata a `redirect_uri` que o servidor tenta — o SDK não expõe
        // qual ele usou no diálogo, então quem sabe o endereço é o navegador.
        redirectUri: typeof window === 'undefined' ? undefined : `${window.location.origin}${window.location.pathname}`,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  });
}

export function useRefreshMetaConnection() {
  const qc = useQueryClient();
  return useMutation<{ connection: MetaConnectionView }, Error, string>({
    mutationFn: (id) =>
      api.post<{ connection: MetaConnectionView }>(`/api/meta/connections/${id}/refresh`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  });
}

export function useRemoveMetaConnection() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (id) => api.delete(`/api/meta/connections/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CONNECTIONS_KEY }),
  });
}
