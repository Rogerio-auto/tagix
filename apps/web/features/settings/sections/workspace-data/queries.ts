'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  usageCount: number;
}

export interface AuditLog {
  id: string;
  actorMemberId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditFilters {
  action?: string;
  resourceType?: string;
  actorType?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditResponse {
  logs: AuditLog[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const dataKeys = {
  tags: ['tags'] as const,
  audit: (f: AuditFilters) => ['audit', f] as const,
};

// ─── Tags ─────────────────────────────────────────────────────────────────────
export function useTags() {
  return useQuery({
    queryKey: dataKeys.tags,
    queryFn: () => api.get<{ tags: Tag[] }>('/api/tags'),
  });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation<{ tag: Tag }, Error, { name: string; color?: string }>({
    mutationFn: (input) => api.post<{ tag: Tag }>('/api/tags', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dataKeys.tags }),
  });
}

export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation<{ tag: Tag }, Error, { id: string; name?: string; color?: string }>({
    mutationFn: ({ id, ...patch }) => api.patch<{ tag: Tag }>(`/api/tags/${id}`, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dataKeys.tags }),
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete<void>(`/api/tags/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dataKeys.tags }),
  });
}

// ─── Audit ────────────────────────────────────────────────────────────────────
export function useAuditLogs(filters: AuditFilters) {
  const params = new URLSearchParams();
  if (filters.action) params.set('action', filters.action);
  if (filters.resourceType) params.set('resourceType', filters.resourceType);
  if (filters.actorType) params.set('actorType', filters.actorType);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  const qs = params.toString();
  return useQuery({
    queryKey: dataKeys.audit(filters),
    queryFn: () => api.get<AuditResponse>(`/api/audit${qs ? `?${qs}` : ''}`),
    placeholderData: (prev) => prev,
  });
}
