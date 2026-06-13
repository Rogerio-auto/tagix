'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type {
  Channel,
  ConnectChannelInput,
  IgAccountCandidate,
  IgConnectInput,
} from './types';

const CHANNELS_KEY = ['channels'] as const;

export function useChannels() {
  return useQuery({
    queryKey: CHANNELS_KEY,
    queryFn: () => api.get<{ channels: Channel[] }>('/api/channels'),
  });
}

/** Conecta um canal (Meta WhatsApp/IG ou WAHA). Invalida a lista no sucesso. */
export function useConnectChannel() {
  const queryClient = useQueryClient();
  return useMutation<{ channel: Channel }, Error, ConnectChannelInput>({
    mutationFn: (input) => api.post<{ channel: Channel }>('/api/channels/connect', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHANNELS_KEY });
    },
  });
}

/** Ativa/desativa um canal. Invalida a lista no sucesso. */
export function useSetChannelActive() {
  const queryClient = useQueryClient();
  return useMutation<{ channel: Channel }, Error, { id: string; isActive: boolean }>({
    mutationFn: ({ id, isActive }) =>
      api.patch<{ channel: Channel }>(`/api/channels/${id}/disable`, { isActive }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHANNELS_KEY });
    },
  });
}

/** Remove um canal (OWNER). Invalida a lista no sucesso. */
export function useDeleteChannel() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => api.delete<void>(`/api/channels/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHANNELS_KEY });
    },
  });
}

/** Lista as contas IG (Page+IGBA) a partir do user access token (F15-S06). */
export function useListInstagramAccounts() {
  return useMutation<{ accounts: IgAccountCandidate[] }, Error, { userAccessToken: string }>({
    mutationFn: (input) =>
      api.post<{ accounts: IgAccountCandidate[] }>('/api/channels/instagram/accounts', input),
  });
}

/** Conecta a conta IG escolhida: subscribe webhook + cria canal + test (F15-S06). */
export function useConnectInstagram() {
  const queryClient = useQueryClient();
  return useMutation<{ channel: Channel; testMessageSent: boolean }, Error, IgConnectInput>({
    mutationFn: (input) =>
      api.post<{ channel: Channel; testMessageSent: boolean }>(
        '/api/channels/instagram/connect',
        input,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CHANNELS_KEY });
    },
  });
}
