'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type {
  ApplyNicheInput,
  ApplyNicheResult,
  OnboardingStateResponse,
  SurveyInput,
  WorkspaceOnboardingState,
} from './types';

/**
 * React Query hooks do onboarding / first-run (F43-S05). Consome a API do F43-S04:
 *
 *   GET  /api/onboarding/state   → estado de onboarding + checklist + tour
 *   PUT  /api/onboarding/survey  → grava a mini-pesquisa
 *   POST /api/onboarding/apply   → aplica o blueprint do nicho
 *
 * `state` é gated por `workspace.edit` no servidor (ADMIN/OWNER). Para membros sem
 * essa permissão a chamada falha — o provider trata isso como "não abrir o wizard".
 */
export const onboardingKeys = {
  all: ['onboarding'] as const,
  state: ['onboarding', 'state'] as const,
};

export function useOnboardingState(enabled = true) {
  return useQuery<OnboardingStateResponse>({
    queryKey: onboardingKeys.state,
    queryFn: () => api.get<OnboardingStateResponse>('/api/onboarding/state'),
    enabled,
    // O first-run é por sessão — não revalidar agressivamente.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useSaveSurvey() {
  const queryClient = useQueryClient();
  return useMutation<{ onboarding: WorkspaceOnboardingState }, Error, SurveyInput>({
    mutationFn: (input) => api.put<{ onboarding: WorkspaceOnboardingState }>('/api/onboarding/survey', input),
    onSuccess: (data) => {
      // Mantém o estado em cache coerente com a pesquisa recém-salva.
      queryClient.setQueryData<OnboardingStateResponse>(onboardingKeys.state, (prev) =>
        prev ? { ...prev, onboarding: data.onboarding } : prev,
      );
    },
  });
}

export function useApplyNiche() {
  const queryClient = useQueryClient();
  return useMutation<ApplyNicheResult, Error, ApplyNicheInput>({
    mutationFn: (input) => api.post<ApplyNicheResult>('/api/onboarding/apply', input),
    onSuccess: () => {
      // O blueprint cria funil, agente(s), etiquetas, conversões, etc. — invalida as
      // listas afetadas para que o app reflita o setup imediatamente.
      void queryClient.invalidateQueries({ queryKey: onboardingKeys.state });
      void queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
      void queryClient.invalidateQueries({ queryKey: ['conversions'] });
      void queryClient.invalidateQueries({ queryKey: ['flows'] });
    },
  });
}
