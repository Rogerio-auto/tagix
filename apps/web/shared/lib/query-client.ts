'use client';

import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { onApiErrorMaybeExpire } from '@/shared/auth/session-expiry';
import {
  isSubscriptionInactiveError,
  notifySubscriptionInactive,
  setUnauthorizedListener,
} from './api-client';

export function makeQueryClient(): QueryClient {
  // Handler GLOBAL de 401 (F46-S01 → F70-S28). Duas entradas, um só destino
  // (idempotente — vários 401 viram UM redirect):
  //  1. o cliente HTTP avisa em TODO 401 que passa por `api.*`, inclusive a
  //     hidratação de `/api/me`, que roda fora do React Query — era exatamente o 401
  //     de quem abre o app com o cookie morto, e ninguém ouvia;
  //  2. o `onError` dos caches pega `ApiError` 401 lançado por `fetch` cru dentro de
  //     query/mutation (ex.: upload de mídia).
  // `ref` evita use-before-define: os caches só chamam `onError` em runtime.
  const ref: { client: QueryClient | null } = { client: null };
  const onError = (error: unknown): void => {
    onApiErrorMaybeExpire(error, ref.client);
    // 402 `subscription_inactive` lançado por `fetch` cru dentro de query/mutation
    // (o `api.*` já avisa sozinho; o handler é idempotente por tela). Nunca desloga.
    if (isSubscriptionInactiveError(error)) notifySubscriptionInactive(error);
  };

  const client = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
  ref.client = client;

  // Só no navegador: no servidor o registro seria um global compartilhado entre
  // requisições de pessoas diferentes.
  if (typeof window !== 'undefined') {
    setUnauthorizedListener((error) => onApiErrorMaybeExpire(error, client));
  }
  return client;
}
