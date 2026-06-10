'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type {
  CaptureMetadata,
  DealAttachment,
  DealHistoryEntry,
  SignedUrlResponse,
} from './types';
import type { Deal } from '../board/types';

export const dealKeys = {
  detail: (id: string) => ['deal', id] as const,
  history: (id: string) => ['deal', id, 'history'] as const,
  attachments: (id: string) => ['deal', id, 'attachments'] as const,
};

export function useDeal(dealId: string | undefined) {
  return useQuery({
    queryKey: dealKeys.detail(dealId ?? ''),
    queryFn: () => api.get<{ deal: Deal }>(`/api/deals/${dealId}`),
    enabled: Boolean(dealId),
  });
}

export function useDealHistory(dealId: string | undefined) {
  return useQuery({
    queryKey: dealKeys.history(dealId ?? ''),
    queryFn: () => api.get<{ history: DealHistoryEntry[] }>(`/api/deals/${dealId}/history`),
    enabled: Boolean(dealId),
  });
}

export function useDealAttachments(dealId: string | undefined) {
  return useQuery({
    queryKey: dealKeys.attachments(dealId ?? ''),
    queryFn: () => api.get<{ attachments: DealAttachment[] }>(`/api/deals/${dealId}/attachments`),
    enabled: Boolean(dealId),
  });
}

/** Pede a signed URL de upload (PIPELINE.md §5.2 passo 1). */
export function useRequestUploadUrl(dealId: string) {
  return useMutation<SignedUrlResponse, Error, { filename: string; mime: string }>({
    mutationFn: (input) =>
      api.post<SignedUrlResponse>(`/api/deals/${dealId}/attachments/signed-url`, input),
  });
}

/** Persiste o metadata do anexo após o upload direto ao storage (§5.2 passo 3). */
export function usePersistAttachment(dealId: string) {
  const qc = useQueryClient();
  return useMutation<
    { attachment: DealAttachment },
    Error,
    {
      storageKey: string;
      mime: string;
      sizeBytes: number;
      sha256: string;
      filename?: string;
    } & CaptureMetadata
  >({
    mutationFn: (input) =>
      api.post<{ attachment: DealAttachment }>(`/api/deals/${dealId}/attachments`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dealKeys.attachments(dealId) });
      void qc.invalidateQueries({ queryKey: dealKeys.history(dealId) });
    },
  });
}

export function useDeleteAttachment(dealId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (attId) => api.delete<void>(`/api/deals/${dealId}/attachments/${attId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dealKeys.attachments(dealId) });
    },
  });
}
