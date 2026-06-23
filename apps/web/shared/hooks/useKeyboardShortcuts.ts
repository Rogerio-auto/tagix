'use client';

import { useEffect, useRef } from 'react';

export interface Shortcut {
  /** Tecla (case-insensitive), ex.: 'k', 'Escape', '?'. */
  key: string;
  /** Exige Ctrl (Win/Linux) ou Cmd (mac). */
  ctrlOrMeta?: boolean;
  shift?: boolean;
  handler: (e: KeyboardEvent) => void;
}

/**
 * Registra atalhos globais (UX §2.10). Usa ref interna para sempre chamar o
 * handler mais recente sem re-assinar o listener a cada render.
 */
export function useKeyboardShortcuts(shortcuts: readonly Shortcut[]): void {
  const ref = useRef(shortcuts);
  ref.current = shortcuts;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // `e.key` pode ser undefined em eventos sintéticos/composição (IME) e `s.key`
      // pode vir vazio de um atalho mal-registrado — guardar evita derrubar o app
      // inteiro (este listener é global, montado no shell). Sem string → ignora.
      const eventKey = e.key;
      if (typeof eventKey !== 'string') return;
      const hasMod = e.ctrlKey || e.metaKey;
      for (const s of ref.current) {
        if (typeof s.key !== 'string') continue;
        const modOk = s.ctrlOrMeta ? hasMod : !hasMod;
        const shiftOk = s.shift ? e.shiftKey : true;
        if (eventKey.toLowerCase() === s.key.toLowerCase() && modOk && shiftOk) {
          e.preventDefault();
          s.handler(e);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
