'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

/** Provider técnico do canal (espelha o backend / channels_provider_chk). */
export type WindowProvider = 'meta_whatsapp' | 'meta_instagram' | 'waha';

/** Tag de mensagem IG fora da janela (espelha `IgMessageTag` de @hm/channels). */
export type WindowMessageTag =
  | 'HUMAN_AGENT'
  | 'CONFIRMED_EVENT_UPDATE'
  | 'POST_PURCHASE_UPDATE'
  | 'ACCOUNT_UPDATE';

/**
 * Estado da janela de envio 24h para uma conversa (F1-S17).
 * Contrato: `GET /api/conversations/:id/window` → `{ window: WindowState }`.
 */
export interface WindowState {
  provider: WindowProvider;
  /** Agente pode enviar free-form sem template/tag. */
  isOpen: boolean;
  /** ISO da expiração; `null` quando não há inbound ou não se aplica (WAHA). */
  expiresAt: string | null;
  /** WhatsApp fora da janela: só um template reabre a conversa. */
  requiresTemplate: boolean;
  /** Instagram fora da janela: tag exigida (HUMAN_AGENT); `null` quando dentro. */
  messageTag: WindowMessageTag | null;
}

/** Chave de cache do estado da janela — compartilhável para invalidação. */
export function windowKey(conversationId: string) {
  return ['conversation', conversationId, 'window'] as const;
}

/**
 * Lê o estado da janela 24h da conversa. Refaz o fetch ao focar a janela e a
 * cada minuto (a janela expira no tempo, sem evento de servidor garantido).
 */
export function useWindowState(conversationId: string | undefined) {
  return useQuery({
    queryKey: conversationId ? windowKey(conversationId) : ['conversation', 'window', 'idle'],
    queryFn: () => api.get<{ window: WindowState }>(`/api/conversations/${conversationId}/window`),
    enabled: Boolean(conversationId),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
