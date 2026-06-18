'use client';

/**
 * React Query do inbox de suporte da plataforma (F38-S11) sobre a API S10
 * (/api/platform/support/*). Cross-workspace, gated por requirePlatformAdmin.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SupportMessageDTO,
  SupportPlatformFilters,
  SupportPlatformPatch,
  SupportThreadDTO,
} from '@hm/shared';
import { api } from '@/shared/lib/api-client';

const ROOT = ['platform', 'support'] as const;

export function usePlatformThreads(filters: SupportPlatformFilters) {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.priority) qs.set('priority', filters.priority);
  if (filters.workspaceId) qs.set('workspaceId', filters.workspaceId);
  const s = qs.toString();
  return useQuery({
    queryKey: [...ROOT, 'threads', filters.status ?? '', filters.priority ?? '', filters.workspaceId ?? ''] as const,
    queryFn: () =>
      api.get<{ threads: SupportThreadDTO[] }>(`/api/platform/support/threads${s ? `?${s}` : ''}`),
  });
}

export function usePlatformThread(threadId: string | null) {
  return useQuery({
    queryKey: [...ROOT, 'thread', threadId] as const,
    queryFn: () =>
      api.get<{ thread: SupportThreadDTO; messages: SupportMessageDTO[] }>(
        `/api/platform/support/threads/${threadId ?? ''}`,
      ),
    enabled: threadId !== null,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>, threadId: string): void {
  void qc.invalidateQueries({ queryKey: [...ROOT, 'thread', threadId] });
  void qc.invalidateQueries({ queryKey: [...ROOT, 'threads'] });
}

export function usePlatformReply(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api.post<{ message: SupportMessageDTO }>(
        `/api/platform/support/threads/${threadId}/messages`,
        { body },
      ),
    onSuccess: () => invalidate(qc, threadId),
  });
}

export function usePatchThread(threadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SupportPlatformPatch) =>
      api.patch<{ thread: SupportThreadDTO }>(`/api/platform/support/threads/${threadId}`, patch),
    onSuccess: () => invalidate(qc, threadId),
  });
}
