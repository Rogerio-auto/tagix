import type { NotificationSoundPrefs } from '@/features/settings/sections/personal/queries';

export type { NotificationSoundPrefs };

/**
 * Notificação in-app de lembrete de compromisso (F53-S06). Derivada do evento
 * socket `appointment:due` (F53-S05). Persiste na central até o operador
 * descartar ou concluir (UX §2.12 — nível inbox).
 */
export interface AppNotification {
  /** Id do evento de origem (chave estável — dedup por evento). */
  readonly eventId: string;
  readonly contactId: string | null;
  readonly conversationId: string | null;
  /** Título/descrição do compromisso. */
  readonly title: string;
  /** Tipo comercial do evento (follow_up, call, …). */
  readonly type: string;
  readonly priority: 'low' | 'medium' | 'high';
  /** Início do compromisso (ISO 8601). */
  readonly startAt: string;
  /** Momento em que a notificação chegou (epoch ms) — para ordenação. */
  readonly receivedAt: number;
  /** `false` enquanto o operador não abriu a central depois de chegar. */
  seen: boolean;
}

/** Preferências de som default (espelham o default do servidor). */
export const DEFAULT_SOUND_PREFS: NotificationSoundPrefs = {
  enabled: true,
  volume: 0.6,
  repeatUntilConfirmed: false,
  visualOnly: false,
};

/** Um grupo de notificações do mesmo contato (agrupamento — sem spam). */
export interface NotificationGroup {
  /** `contactId` ou, quando ausente, o próprio `eventId` (grupo de 1). */
  readonly key: string;
  readonly contactId: string | null;
  readonly items: readonly AppNotification[];
}
