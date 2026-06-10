'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { InstantiateNicheInput, InstantiateNicheResult } from './types';

/**
 * React Query hooks do onboarding por nicho (F5-S15).
 *
 * Consome `POST /api/onboarding/niche` (gap-fill do orchestrator): instancia o
 * pipeline do nicho (+ agente opcional) no workspace atual. Invalida as listas de
 * pipelines e agentes no sucesso.
 */
export const onboardingKeys = {
  all: ['onboarding'] as const,
};

export function useInstantiateNiche() {
  const queryClient = useQueryClient();
  return useMutation<InstantiateNicheResult, Error, InstantiateNicheInput>({
    mutationFn: (input) =>
      api.post<InstantiateNicheResult>('/api/onboarding/niche', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}
