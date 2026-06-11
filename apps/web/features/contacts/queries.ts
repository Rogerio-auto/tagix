'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/lib/api-client';
import type {
  Contact,
  ContactDetailResponse,
  ContactFilters,
  ContactInput,
  ContactListResponse,
  Tag,
} from './types';

export const contactKeys = {
  all: ['contacts'] as const,
  list: (filters: ContactFilters) => ['contacts', 'list', filters] as const,
  detail: (id: string) => ['contacts', 'detail', id] as const,
  tags: ['tags'] as const,
};

function buildQuery(filters: ContactFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.tagId) params.set('tagId', filters.tagId);
  if (filters.source) params.set('source', filters.source);
  if (filters.optIn) params.set('optIn', filters.optIn);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.sort) params.set('sort', filters.sort);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useContacts(filters: ContactFilters) {
  return useQuery({
    queryKey: contactKeys.list(filters),
    queryFn: () => api.get<ContactListResponse>(`/api/contacts${buildQuery(filters)}`),
    placeholderData: (prev) => prev,
  });
}

export function useContact(id: string | null) {
  return useQuery({
    queryKey: id ? contactKeys.detail(id) : ['contacts', 'detail', 'none'],
    queryFn: () => api.get<ContactDetailResponse>(`/api/contacts/${id}`),
    enabled: id != null,
  });
}

/** Tags do workspace (filtro + atribuição). Degrada p/ [] se a API de tags (S08)
 *  ainda não estiver montada — o filtro some, sem quebrar a página. */
export function useTags() {
  return useQuery({
    queryKey: contactKeys.tags,
    queryFn: async () => {
      try {
        return await api.get<{ tags: Tag[] }>('/api/tags');
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return { tags: [] };
        throw err;
      }
    },
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation<{ contact: Contact }, Error, ContactInput>({
    mutationFn: (input) => api.post<{ contact: Contact }>('/api/contacts', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation<{ contact: Contact }, Error, { id: string; patch: Partial<ContactInput> }>({
    mutationFn: ({ id, patch }) => api.patch<{ contact: Contact }>(`/api/contacts/${id}`, patch),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: contactKeys.all });
      void qc.invalidateQueries({ queryKey: contactKeys.detail(id) });
    },
  });
}

export function useAssignTag() {
  const qc = useQueryClient();
  return useMutation<void, Error, { contactId: string; tagId: string }>({
    mutationFn: ({ contactId, tagId }) =>
      api.post<void>(`/api/contacts/${contactId}/tags`, { tagId }),
    onSuccess: (_d, { contactId }) =>
      void qc.invalidateQueries({ queryKey: contactKeys.detail(contactId) }),
  });
}

export function useRemoveTag() {
  const qc = useQueryClient();
  return useMutation<void, Error, { contactId: string; tagId: string }>({
    mutationFn: ({ contactId, tagId }) =>
      api.delete<void>(`/api/contacts/${contactId}/tags/${tagId}`),
    onSuccess: (_d, { contactId }) =>
      void qc.invalidateQueries({ queryKey: contactKeys.detail(contactId) }),
  });
}
