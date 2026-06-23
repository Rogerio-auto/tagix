'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/shared/lib/api-client';
import type { TourStateInput, TourStateMap } from './types';

/**
 * Persistência do estado de tour por membro (F43-S07). Consome a API do F43-S04:
 *
 *   GET /api/onboarding/state → { tourState }   (estado dos tours do membro)
 *   PUT /api/me/tour-state     → { tourState }   (carimba completed/dismissed)
 *
 * Sutileza de permissão: `GET /state` é gated por `workspace.edit` (ADMIN/OWNER),
 * mas `PUT /me/tour-state` é aberto a qualquer autenticado. Para um membro comum, a
 * leitura falha 403 — tratamos como "nenhum tour visto" (mapa vazio), o que é seguro:
 * o pior caso é o engine não auto-reabrir nada e respeitar a persistência via a
 * resposta do próprio PUT. Falha fechado, sem ruído de erro.
 */

// Key PRÓPRIA — NÃO compartilhar com `useOnboardingState` (que usa
// ['onboarding','state'] e retorna a resposta inteira). Dois observers na mesma key
// com queryFn diferentes fazem o cache ping-pongar (refetch infinito) e ainda
// sobrescrevem o shape um do outro (o tour gravava só o TourStateMap na key da
// resposta completa → quebrava `data.onboarding`). Key distinta isola os dois.
export const tourKeys = {
  state: ['onboarding', 'tour-state'] as const,
};

/** Subset de `GET /api/onboarding/state` que nos interessa (só o tourState). */
interface OnboardingStateTourSlice {
  tourState?: TourStateMap;
}

/**
 * Lê o `tourState` do membro. Resiliente a 403 (membro sem `workspace.edit`):
 * resolve como mapa vazio em vez de erro. `enabled` permite só consultar quando há
 * sessão hidratada.
 */
export function useTourState(enabled = true) {
  return useQuery<TourStateMap>({
    queryKey: tourKeys.state,
    queryFn: async () => {
      try {
        const data = await api.get<OnboardingStateTourSlice>('/api/onboarding/state');
        return data.tourState ?? {};
      } catch (err) {
        // 403/401 → membro sem acesso ao estado de onboarding: trata como "nada visto".
        if (err instanceof ApiError && (err.status === 403 || err.status === 401)) return {};
        throw err;
      }
    },
    enabled,
    // First-run é por sessão — não revalidar agressivamente.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/**
 * Carimba um tour como concluído ou dispensado. Atualiza o cache do `tourState`
 * com a resposta autoritativa do servidor para não reabrir o tour na sessão atual.
 */
export function useMarkTour() {
  const queryClient = useQueryClient();
  return useMutation<{ tourState: TourStateMap }, Error, TourStateInput>({
    mutationFn: (input) => api.put<{ tourState: TourStateMap }>('/api/me/tour-state', input),
    onSuccess: (data) => {
      queryClient.setQueryData<TourStateMap>(tourKeys.state, data.tourState);
    },
  });
}
