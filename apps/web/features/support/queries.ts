'use client';

/**
 * React Query do Chat de Suporte do membro (F38-S09) sobre a API S07
 * (/api/support/*). Tipos vem de @hm/shared. Tudo workspace-scoped no backend.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SupportMessageDTO,
  SupportOpenThreadInput,
  SupportThreadDTO,
} from '@hm/shared';
import { api } from '@/shared/lib/api-client';

const THREADS = ['support', 'threads'] as const;

export function useSupportThreads(enabled: boolean) {
  return useQuery({
    queryKey: THREADS,
    queryFn: () => api.get<{ threads: SupportThreadDTO[] }>('/api/support/threads'),
    enabled,
  });
}

export function useSupportThread(threadId: string | null) {
  return useQuery({
    queryKey: ['support', 'thread', threadId] as const,
    queryFn: () =>
      api.get<{ thread: SupportThreadDTO; messages: SupportMessageDTO[] }>(
        `/api/support/threads/${threadId ?? ''}`,
      ),
    enabled: threadId !== null,
  });
}

export function useOpenThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SupportOpenThreadInput) =>
      api.post<{ thread: SupportThreadDTO; message: SupportMessageDTO }>(
        '/api/support/threads',
        input,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: THREADS }),
  });
}

export function useSendMessage(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api.post<{ message: SupportMessageDTO }>(`/api/support/threads/${threadId}/messages`, {
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['support', 'thread', threadId] });
      void qc.invalidateQueries({ queryKey: THREADS });
    },
  });
}

export function useResolveThread(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ thread: SupportThreadDTO }>(`/api/support/threads/${threadId}/resolve`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['support', 'thread', threadId] });
      void qc.invalidateQueries({ queryKey: THREADS });
    },
  });
}
