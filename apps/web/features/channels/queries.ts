'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';
import type { Channel, ConnectChannelInput } from './types';

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
