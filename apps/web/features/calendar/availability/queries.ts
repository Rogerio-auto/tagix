'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type {
  AvailabilityException,
  AvailabilityRule,
  AvailabilitySlot,
  ExceptionInput,
  RuleInput,
} from './types';

export const availabilityKeys = {
  rules: ['availability', 'rules'] as const,
  exceptions: ['availability', 'exceptions'] as const,
  slots: (memberId: string | undefined, date: string) =>
    ['availability', 'slots', memberId ?? 'self', date] as const,
};

export function useAvailabilityRules() {
  return useQuery({
    queryKey: availabilityKeys.rules,
    queryFn: () => api.get<{ rules: AvailabilityRule[] }>('/api/availability/rules'),
  });
}

export function useSaveAvailabilityRules() {
  const qc = useQueryClient();
  return useMutation<{ rules: AvailabilityRule[] }, Error, RuleInput[]>({
    mutationFn: (rules) =>
      api.put<{ rules: AvailabilityRule[] }>('/api/availability/rules', { rules }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: availabilityKeys.rules });
      void qc.invalidateQueries({ queryKey: ['availability', 'slots'] });
    },
  });
}

export function useAvailabilityExceptions() {
  return useQuery({
    queryKey: availabilityKeys.exceptions,
    queryFn: () =>
      api.get<{ exceptions: AvailabilityException[] }>('/api/availability/exceptions'),
  });
}

export function useCreateException() {
  const qc = useQueryClient();
  return useMutation<{ exception: AvailabilityException }, Error, ExceptionInput>({
    mutationFn: (input) =>
      api.post<{ exception: AvailabilityException }>('/api/availability/exceptions', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: availabilityKeys.exceptions });
      void qc.invalidateQueries({ queryKey: ['availability', 'slots'] });
    },
  });
}

export function useDeleteException() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete<void>(`/api/availability/exceptions/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: availabilityKeys.exceptions });
      void qc.invalidateQueries({ queryKey: ['availability', 'slots'] });
    },
  });
}

/** Consulta os slots disponíveis numa data — usado para previewar o efeito das regras. */
export function useAvailabilitySlots(date: string, enabled: boolean) {
  return useQuery({
    queryKey: availabilityKeys.slots(undefined, date),
    enabled: enabled && date.length === 10,
    queryFn: () =>
      api.get<{ memberId: string; date: string; slots: AvailabilitySlot[] }>(
        `/api/availability/slots?date=${date}`,
      ),
  });
}
