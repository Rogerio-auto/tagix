'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { Campaign, CampaignDelivery, CampaignMetrics } from './types';

export const campaignKeys = {
  list: (status?: string) => ['campaigns', status ?? 'all'] as const,
  detail: (id: string) => ['campaign', id] as const,
  metrics: (id: string) => ['campaign-metrics', id] as const,
  deliveries: (id: string) => ['campaign-deliveries', id] as const,
};

export function useCampaigns(status = '') {
  const q = status ? `?status=${status}` : '';
  return useQuery({
    queryKey: campaignKeys.list(status),
    queryFn: () => api.get<{ campaigns: Campaign[] }>(`/api/campaigns${q}`),
  });
}

export function useCampaignMetrics(id: string, enabled = true) {
  return useQuery({
    queryKey: campaignKeys.metrics(id),
    queryFn: () => api.get<{ metrics: CampaignMetrics }>(`/api/campaigns/${id}/metrics`),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useCampaignDeliveries(id: string, enabled = true) {
  return useQuery({
    queryKey: campaignKeys.deliveries(id),
    queryFn: () =>
      api.get<{ deliveries: CampaignDelivery[] }>(`/api/campaigns/${id}/deliveries?status=failed`),
    enabled,
    refetchInterval: 30_000,
  });
}

function useCampaignAction(action: 'pause' | 'resume') {
  const qc = useQueryClient();
  return useMutation<{ campaign: Campaign }, Error, string>({
    mutationFn: (id) => api.post<{ campaign: Campaign }>(`/api/campaigns/${id}/${action}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export const usePauseCampaign = () => useCampaignAction('pause');
export const useResumeCampaign = () => useCampaignAction('resume');

export function useCancelCampaign() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete<void>(`/api/campaigns/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}
