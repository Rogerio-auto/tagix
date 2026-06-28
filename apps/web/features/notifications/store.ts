'use client';

import { create } from 'zustand';
import { DEFAULT_SOUND_PREFS, type AppNotification, type NotificationGroup } from './types';
import type { NotificationSoundPrefs } from '@/features/settings/sections/personal/queries';

/**
 * Store da central de notificações (F53-S06).
 *
 * Persistência (UX §2.12 — nível inbox): a lista e as preferências de som ficam
 * em `localStorage` para sobreviver a refresh/navegação até o operador descartar
 * ou concluir. As prefs de som têm a FONTE DA VERDADE no servidor
 * (`notificationPrefs.sound`); aqui guardamos um espelho de runtime (escrito pela
 * tela de Configurações ao salvar) para o sistema de som responder sem round-trip.
 *
 * Hidratação manual (mesmo padrão de `ui.store`): SSR-safe, sem flash.
 */
const LIST_KEY = 'hm:notifications';
const SOUND_KEY = 'hm:notif-sound';

interface NotificationsState {
  notifications: AppNotification[];
  soundPrefs: NotificationSoundPrefs;
  /** Central aberta (overlay/sheet). */
  open: boolean;
  /** Token que muda a cada nova notificação aceita — gatilho idempotente do som. */
  lastArrivalAt: number | null;
  hydrated: boolean;

  /** Lê lista + prefs do `localStorage`. Chamar uma vez no client após mount. */
  hydrate: () => void;
  /** Adiciona (ou refresca) uma notificação; dedup por `eventId`. */
  push: (n: Omit<AppNotification, 'seen' | 'receivedAt'>) => void;
  /** Remove uma notificação (descartar / concluído). */
  remove: (eventId: string) => void;
  /** Limpa todas. */
  clear: () => void;
  setOpen: (open: boolean) => void;
  /** Marca todas como vistas (zera o badge) — chamado ao abrir a central. */
  markAllSeen: () => void;
  /** Atualiza o espelho de runtime das prefs de som. */
  setSoundPrefs: (prefs: NotificationSoundPrefs) => void;
}

function persistList(list: AppNotification[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
  } catch {
    // quota/serialização — silencioso (a lista em memória é a verdade da sessão).
  }
}

function persistSound(prefs: NotificationSoundPrefs): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SOUND_KEY, JSON.stringify(prefs));
  } catch {
    /* silencioso */
  }
}

function readList(): AppNotification[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (n): n is AppNotification =>
        typeof n === 'object' && n !== null && typeof (n as { eventId?: unknown }).eventId === 'string',
    );
  } catch {
    return [];
  }
}

function readSound(): NotificationSoundPrefs {
  if (typeof localStorage === 'undefined') return DEFAULT_SOUND_PREFS;
  try {
    const raw = localStorage.getItem(SOUND_KEY);
    if (!raw) return DEFAULT_SOUND_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SOUND_PREFS;
    const p = parsed as Partial<NotificationSoundPrefs>;
    return {
      enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_SOUND_PREFS.enabled,
      volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : DEFAULT_SOUND_PREFS.volume,
      repeatUntilConfirmed:
        typeof p.repeatUntilConfirmed === 'boolean'
          ? p.repeatUntilConfirmed
          : DEFAULT_SOUND_PREFS.repeatUntilConfirmed,
      visualOnly: typeof p.visualOnly === 'boolean' ? p.visualOnly : DEFAULT_SOUND_PREFS.visualOnly,
    };
  } catch {
    return DEFAULT_SOUND_PREFS;
  }
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  notifications: [],
  soundPrefs: DEFAULT_SOUND_PREFS,
  open: false,
  lastArrivalAt: null,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({ notifications: readList(), soundPrefs: readSound(), hydrated: true });
  },

  push: (incoming) => {
    const existing = get().notifications;
    // Dedup por evento: se já existe, mantém (não reabre badge nem retoca o som).
    if (existing.some((n) => n.eventId === incoming.eventId)) return;
    const next: AppNotification = { ...incoming, receivedAt: Date.now(), seen: false };
    const list = [next, ...existing];
    persistList(list);
    set({ notifications: list, lastArrivalAt: next.receivedAt });
  },

  remove: (eventId) => {
    const list = get().notifications.filter((n) => n.eventId !== eventId);
    persistList(list);
    set({ notifications: list });
  },

  clear: () => {
    persistList([]);
    set({ notifications: [] });
  },

  setOpen: (open) => {
    set({ open });
    if (open) get().markAllSeen();
  },

  markAllSeen: () => {
    const list = get().notifications.map((n) => (n.seen ? n : { ...n, seen: true }));
    persistList(list);
    set({ notifications: list });
  },

  setSoundPrefs: (prefs) => {
    persistSound(prefs);
    set({ soundPrefs: prefs });
  },
}));

/** Agrupa por contato (UX: agrupamento, sem spam). Mantém a ordem por chegada. */
export function groupByContact(list: readonly AppNotification[]): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  const byKey = new Map<string, AppNotification[]>();
  for (const n of list) {
    const key = n.contactId ?? `__event:${n.eventId}`;
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(n);
    } else {
      const fresh = [n];
      byKey.set(key, fresh);
      groups.push({ key, contactId: n.contactId, items: fresh });
    }
  }
  return groups;
}
