'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type {
  CreateKbDocumentInput,
  KbDocument,
  KbDocumentDetail,
  KbDocumentListResponse,
  KbListFilters,
  UpdateKbDocumentInput,
} from './types';

/**
 * React Query hooks da Knowledge Base (F3-S06). Consome a API de F3-S04:
 *   POST   /api/knowledge/documents
 *   GET    /api/knowledge/documents               (+ filtros status/category/q)
 *   GET    /api/knowledge/documents/:id           (doc + preview de chunks)
 *   PATCH  /api/knowledge/documents/:id           (metadados)
 *   POST   /api/knowledge/documents/:id/reprocess
 *   DELETE /api/knowledge/documents/:id           (archive; ?hard=true apaga)
 *
 * `queryKeys` é a única fonte das chaves de cache (F3-S07 importa read-only).
 */
export const knowledgeKeys = {
  all: ['knowledge'] as const,
  lists: () => [...knowledgeKeys.all, 'list'] as const,
  list: (filters: KbListFilters) => [...knowledgeKeys.lists(), filters] as const,
  detail: (id: string) => [...knowledgeKeys.all, 'detail', id] as const,
};

function buildListQuery(filters: KbListFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.category) params.set('category', filters.category);
  if (filters.q) params.set('q', filters.q);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Lista documentos. Faz polling enquanto houver doc em indexação (`draft`). */
export function useKbDocuments(filters: KbListFilters = {}) {
  return useQuery({
    queryKey: knowledgeKeys.list(filters),
    queryFn: () =>
      api.get<KbDocumentListResponse>(`/api/knowledge/documents${buildListQuery(filters)}`),
    // Status quase-real: enquanto algum doc estiver `draft` (indexando), refaz a cada 4s.
    refetchInterval: (query) => {
      const data = query.state.data as KbDocumentListResponse | undefined;
      const indexing = data?.documents.some((d) => d.status === 'draft');
      return indexing ? 4000 : false;
    },
  });
}

export function useKbDocument(id: string | undefined) {
  return useQuery({
    queryKey: knowledgeKeys.detail(id ?? ''),
    queryFn: () => api.get<KbDocumentDetail>(`/api/knowledge/documents/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const data = query.state.data as KbDocumentDetail | undefined;
      return data?.document.status === 'draft' ? 4000 : false;
    },
  });
}

export function useCreateKbDocument() {
  const queryClient = useQueryClient();
  return useMutation<{ document: KbDocument }, Error, CreateKbDocumentInput>({
    mutationFn: (input) => api.post<{ document: KbDocument }>('/api/knowledge/documents', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists() });
    },
  });
}

export function useUpdateKbDocument() {
  const queryClient = useQueryClient();
  return useMutation<{ document: KbDocument }, Error, { id: string; patch: UpdateKbDocumentInput }>({
    mutationFn: ({ id, patch }) =>
      api.patch<{ document: KbDocument }>(`/api/knowledge/documents/${id}`, patch),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.detail(id) });
    },
  });
}

export function useReprocessKbDocument() {
  const queryClient = useQueryClient();
  return useMutation<{ documentId: string; reason: string }, Error, string>({
    mutationFn: (id) =>
      api.post<{ documentId: string; reason: string }>(
        `/api/knowledge/documents/${id}/reprocess`,
      ),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.detail(id) });
    },
  });
}

/** Arquiva o documento (soft). Para apagar de vez, use `?hard=true` (não exposto na UI). */
export function useArchiveKbDocument() {
  const queryClient = useQueryClient();
  return useMutation<{ document: KbDocument }, Error, string>({
    mutationFn: (id) => api.delete<{ document: KbDocument }>(`/api/knowledge/documents/${id}`),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.detail(id) });
    },
  });
}
