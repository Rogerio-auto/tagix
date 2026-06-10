'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type {
  ConversionEvent,
  ConversionType,
  CreateConversionTypeInput,
  RegisterConversionInput,
} from './types';

export const conversionKeys = {
  types: ['conversion-types'] as const,
  events: (filters?: string) => ['conversions', filters ?? 'all'] as const,
};

export function useConversionTypes() {
  return useQuery({
    queryKey: conversionKeys.types,
    queryFn: () => api.get<{ conversionTypes: ConversionType[] }>('/api/conversion-types'),
  });
}

export function useConversions(query = '') {
  return useQuery({
    queryKey: conversionKeys.events(query),
    queryFn: () => api.get<{ conversions: ConversionEvent[] }>(`/api/conversions${query}`),
  });
}

export function useRegisterConversion() {
  const qc = useQueryClient();
  return useMutation<{ conversion: ConversionEvent }, Error, RegisterConversionInput>({
    mutationFn: (input) => api.post<{ conversion: ConversionEvent }>('/api/conversions', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversions'] });
    },
  });
}

export function useCancelConversion() {
  const qc = useQueryClient();
  return useMutation<{ conversion: ConversionEvent }, Error, { id: string; reason?: string }>({
    mutationFn: ({ id, reason }) =>
      api.post<{ conversion: ConversionEvent }>(`/api/conversions/${id}/cancel`, { reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversions'] });
    },
  });
}

export function useCreateConversionType() {
  const qc = useQueryClient();
  return useMutation<{ conversionType: ConversionType }, Error, CreateConversionTypeInput>({
    mutationFn: (input) =>
      api.post<{ conversionType: ConversionType }>('/api/conversion-types', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: conversionKeys.types });
    },
  });
}

export function useDeleteConversionType() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete<void>(`/api/conversion-types/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: conversionKeys.types });
    },
  });
}
