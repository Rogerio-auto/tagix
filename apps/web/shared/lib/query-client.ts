'use client';

import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { onApiErrorMaybeExpire } from '@/shared/auth/session-expiry';

export function makeQueryClient(): QueryClient {
  // Handler GLOBAL de 401 (F46-S01): qualquer query/mutation que volte 401 com
  // sessão ativa → purga caches + desconecta socket + redireciona p/ login. O
  // handler precisa do próprio client (para `clear()`), que só existe depois —
  // `ref` evita use-before-define; os caches só chamam `onError` em runtime.
  const ref: { client: QueryClient | null } = { client: null };
  const onError = (error: unknown): void => {
    if (ref.client) onApiErrorMaybeExpire(error, ref.client);
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
  return client;
}
