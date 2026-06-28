'use client';

import { useEffect, useRef } from 'react';
import { useNotificationsStore } from './store';
import { playChime } from './sound';

/** Intervalo (ms) do "repetir até confirmação" — espaçado para não virar spam. */
const REPEAT_INTERVAL_MS = 20_000;

/**
 * Sistema de som da central (F53-S06). Montado UMA vez (dentro da central, no
 * `AppLayout`). Regras:
 *  - Toca o chime a cada nova notificação aceita (gatilho idempotente via
 *    `lastArrivalAt`), respeitando `enabled` + `visualOnly` + `volume`.
 *  - "Repetir até confirmação": enquanto houver notificação pendente e a pref
 *    estiver ligada, re-toca em intervalo até a lista esvaziar (descartar/concluir).
 *  - Áudio é independente de `prefers-reduced-motion` (som não é movimento), mas o
 *    DESTAQUE visual pulsante na UI é gated por `motion-safe` (ver componentes).
 */
export function useNotificationSound(): void {
  const lastArrivalAt = useNotificationsStore((s) => s.lastArrivalAt);
  const hasPending = useNotificationsStore((s) => s.notifications.length > 0);
  const prefs = useNotificationsStore((s) => s.soundPrefs);

  const audible = prefs.enabled && !prefs.visualOnly;
  const playedFor = useRef<number | null>(null);

  // Chime ao chegar uma nova notificação (uma vez por chegada).
  useEffect(() => {
    if (!audible || lastArrivalAt === null) return;
    if (playedFor.current === lastArrivalAt) return;
    playedFor.current = lastArrivalAt;
    playChime(prefs.volume);
  }, [audible, lastArrivalAt, prefs.volume]);

  // Repetir até confirmação: re-toca em intervalo enquanto houver pendência.
  useEffect(() => {
    if (!audible || !prefs.repeatUntilConfirmed || !hasPending) return;
    const id = window.setInterval(() => {
      // Não insistir com a aba oculta em primeiro plano de áudio — o navegador
      // pode bloquear e seria intrusivo; o alerta visual e o badge persistem.
      if (typeof document !== 'undefined' && document.hidden) return;
      playChime(prefs.volume);
    }, REPEAT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [audible, prefs.repeatUntilConfirmed, prefs.volume, hasPending]);
}
