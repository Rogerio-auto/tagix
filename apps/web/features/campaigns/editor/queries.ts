'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type {
  BulkRecipientsResult,
  CampaignDetail,
  CampaignStepInput,
  CreateCampaignInput,
  ValidationResult,
} from './types';

export type {
  BulkRecipientsResult,
  CampaignDetail,
  CampaignStepInput,
  CreateCampaignInput,
  SendWindowSlot,
  SendWindowsConfig,
  ValidationResult,
} from './types';

/** Mesma chave usada em `features/campaigns/list` — cache compartilhado do detalhe. */
export const campaignDetailKey = (id: string) => ['campaign', id] as const;

/**
 * Hidratacao do modo edicao (CAMP-05). Sem retry automatico em 404/403: erro de
 * autorizacao/inexistencia nao melhora tentando de novo.
 */
export function useCampaignDetail(id: string | undefined) {
  return useQuery({
    queryKey: campaignDetailKey(id ?? ''),
    queryFn: () => api.get<CampaignDetail>(`/api/campaigns/${id ?? ''}`),
    enabled: Boolean(id),
    // O rascunho em edicao e a fonte da verdade na tela: refetch em foco poderia
    // reidratar por cima do trabalho do usuario (a guarda de hidratacao impede,
    // mas nao faz sentido gastar rede).
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation<{ campaign: { id: string } }, Error, CreateCampaignInput>({
    mutationFn: (input) => api.post<{ campaign: { id: string } }>('/api/campaigns', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useUpdateCampaign(id: string) {
  const queryClient = useQueryClient();
  return useMutation<{ campaign: { id: string } }, Error, Partial<CreateCampaignInput>>({
    mutationFn: (input) => api.put<{ campaign: { id: string } }>(`/api/campaigns/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: campaignDetailKey(id) });
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useSetSteps(id: string) {
  const queryClient = useQueryClient();
  return useMutation<{ steps: unknown[] }, Error, CampaignStepInput[]>({
    mutationFn: (steps) => api.put<{ steps: unknown[] }>(`/api/campaigns/${id}/steps`, { steps }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: campaignDetailKey(id) });
    },
  });
}

export function useUploadRecipients(id: string) {
  return useMutation<
    BulkRecipientsResult,
    Error,
    { rows: Array<{ phone: string; name?: string }>; source?: string; optInOnImport?: boolean }
  >({
    mutationFn: (body) =>
      api.post<BulkRecipientsResult>(`/api/campaigns/${id}/recipients/bulk`, body),
  });
}

export function useValidateCampaign(id: string) {
  return useMutation<ValidationResult, Error, void>({
    mutationFn: () => api.post<ValidationResult>(`/api/campaigns/${id}/validate`),
  });
}

export function useActivateCampaign(id: string) {
  const queryClient = useQueryClient();
  return useMutation<{ campaign: { id: string } }, Error, void>({
    mutationFn: () => api.post<{ campaign: { id: string } }>(`/api/campaigns/${id}/activate`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: campaignDetailKey(id) });
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}
