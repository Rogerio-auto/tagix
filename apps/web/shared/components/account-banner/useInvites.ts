'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import { useAuthStore } from '@/shared/stores/auth.store';
import { INVITES_RESPONSE_SCHEMA, type PendingInvite } from './banner-priority';

export const PENDING_INVITES_KEY = ['me', 'invites'] as const;

/**
 * Convites pendentes de quem está logado. Falha em silêncio (sem faixa): um erro
 * aqui nunca pode atrapalhar o app — o convite continua válido pelo link do email.
 */
export function usePendingInvites(): PendingInvite[] {
  const authenticated = useAuthStore((s) => s.status === 'authenticated');
  const query = useQuery({
    queryKey: PENDING_INVITES_KEY,
    queryFn: async () =>
      INVITES_RESPONSE_SCHEMA.parse(await api.get<unknown>('/api/me/invites')).invites,
    enabled: authenticated,
    staleTime: 60_000,
    retry: false,
  });
  return query.data ?? [];
}
