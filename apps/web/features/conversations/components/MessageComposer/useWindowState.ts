'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api-client';

/** Provider técnico do canal (espelha o backend / channels_provider_chk). */
export type WindowProvider = 'meta_whatsapp' | 'meta_instagram' | 'waha' | 'email';

/** Tag de mensagem IG fora da janela (espelha `IgMessageTag` de @hm/channels). */
export type WindowMessageTag =
  | 'HUMAN_AGENT'
  | 'CONFIRMED_EVENT_UPDATE'
  | 'POST_PURCHASE_UPDATE'
  | 'ACCOUNT_UPDATE';

/**
 * Estado da janela de envio 24h para uma conversa (F1-S17).
 * Contrato: `GET /api/conversations/:id/window` → `WindowResponse`.
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

/**
 * Motivo da restrição (espelha `SendRestriction['reason']` da API, F60-S02).
 * `provider_window` = regra do provider (Meta 24h); os demais são o enum estável
 * do portão de consentimento (`OutboundDenyReason`).
 */
export type SendRestrictionReason =
  | 'ok'
  | 'provider_window'
  | 'suppressed'
  | 'no_consent'
  | 'quiet_hours'
  | 'registration_pending'
  | 'channel_disabled';

/**
 * Restrição de envio decidida pela API a partir do portão de consentimento
 * combinado com a janela do provider. A interface só LÊ: nenhuma regra de
 * bloqueio é recalculada aqui (F60-S11).
 */
export interface SendRestriction {
  canSend: boolean;
  reason: SendRestrictionReason;
  /** Frase pronta para o atendente (vazia quando `reason === 'ok'`). */
  message: string;
  /** ISO de quando volta a poder; `null` quando não se resolve com o tempo. */
  retryAt: string | null;
}

export interface WindowResponse {
  window: WindowState;
  /**
   * Sempre presente a partir da F60-S02. Opcional no tipo para tolerar descompasso
   * de deploy (web novo falando com API antiga) sem quebrar o composer.
   */
  restriction?: SendRestriction;
}

/** Chave de cache do estado da janela — compartilhável para invalidação. */
export function windowKey(conversationId: string) {
  return ['conversation', conversationId, 'window'] as const;
}

/**
 * Lê o estado da janela 24h da conversa e a restrição de envio do portão. Refaz o fetch ao focar a janela e a
 * cada minuto (a janela expira no tempo, sem evento de servidor garantido).
 */
export function useWindowState(conversationId: string | undefined) {
  return useQuery({
    queryKey: conversationId ? windowKey(conversationId) : ['conversation', 'window', 'idle'],
    queryFn: () => api.get<WindowResponse>(`/api/conversations/${conversationId}/window`),
    enabled: Boolean(conversationId),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
