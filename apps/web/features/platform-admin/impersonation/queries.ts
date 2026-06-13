'use client';

/**
 * React Query do view-as / impersonation (F26-S09) sobre a API F26-S05.
 * Decisao travada: SO view-as READ-ONLY.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

export interface ImpersonationSession {
  readonly id: string;
  readonly adminMemberId: string;
  readonly targetWorkspaceId: string;
  readonly mode: 'view';
  readonly reason: string;
  readonly startedAt: string;
  readonly expiresAt: string;
}

export interface StartedSession {
  readonly id: string;
  readonly targetWorkspaceId: string;
  readonly targetWorkspaceName: string;
  readonly mode: 'view';
  readonly reason: string;
  readonly startedAt: string;
  readonly expiresAt: string;
}

export function useActiveSessions() {
  return useQuery({
    queryKey: ['platform', 'impersonation'],
    queryFn: () => api.get<{ sessions: ImpersonationSession[] }>('/api/platform/impersonation'),
  });
}

export function useStartImpersonation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { workspaceId: string; reason: string }) =>
      api.post<{ session: StartedSession }>('/api/platform/impersonation', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'impersonation'] }),
  });
}

export function useEndImpersonation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ended: boolean }>(`/api/platform/impersonation/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'impersonation'] }),
  });
}
